const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const QRCode = require("qrcode");

// -------------------- CONFIGURATION --------------------

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "groups.json");

function loadEnv() {
  const envPath = path.join(ROOT, ".env");

  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^\s*([\w]+)\s*=\s*(.*?)\s*$/);

    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

loadEnv();

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_CURRENCY = (
  process.env.CURRENCY || "INR"
).toUpperCase();

const PAYPAL_BASE_URL = (
  process.env.PAYPAL_BASE_URL ||
  "https://api-m.sandbox.paypal.com"
).replace(/\/$/, "");

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";

fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ groups: [] }, null, 2));
}

// -------------------- GENERAL HELPERS --------------------

function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(JSON.stringify(data));
}

function error(res, status, message) {
  send(res, status, { success: false, error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    const limit = 16 * 1024 * 1024;

    req.on("data", chunk => {
      size += chunk.length;

      if (size > limit) {
        reject(new Error("Request is too large."));
        req.destroy();
        return;
      }

      data += chunk;
    });

    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON request."));
      }
    });

    req.on("error", reject);
  });
}

function readDatabase() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

    if (!Array.isArray(data.groups)) {
      return { groups: [] };
    }

    return data;
  } catch {
    return { groups: [] };
  }
}

function writeDatabase(database) {
  const tempFile = DATA_FILE + ".tmp";

  fs.writeFileSync(tempFile, JSON.stringify(database, null, 2));
  fs.renameSync(tempFile, DATA_FILE);
}

function makeId() {
  return crypto.randomBytes(8).toString("hex");
}

function toCents(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    throw new Error("Invalid amount.");
  }

  return Math.round((number + Number.EPSILON) * 100);
}

function fromCents(value) {
  return Number((value / 100).toFixed(2));
}

function formatAmount(cents, currency) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(cents / 100);
}

function splitCents(total, ids, weights) {
  if (!ids.length) {
    throw new Error("At least one consumer is required.");
  }

  const totalWeight = weights
    ? weights.reduce((sum, value) => sum + value, 0)
    : ids.length;

  const result = {};
  let allocated = 0;

  if (totalWeight === 0) {
    return splitCents(total, ids);
  }

  ids.forEach((id, index) => {
    let amount;

    if (index === ids.length - 1) {
      amount = total - allocated;
    } else {
      const weight = weights ? weights[index] : 1;
      amount = Math.floor((total * weight) / totalWeight);
    }

    result[id] = amount;
    allocated += amount;
  });

  return result;
}

function safeGroup(group) {
  return {
    id: group.id,
    title: group.title,
    currency: group.currency,
    totalAmount: fromCents(group.totalCents),
    extraAmount: fromCents(group.extraCents),
    createdAt: group.createdAt,
    creatorId: group.creatorId,
    creatorName: group.creatorName,
    upiId: group.upiId || "",
    items: group.items.map(item => ({
      id: item.id,
      name: item.name,
      amount: fromCents(item.amountCents),
      consumerIds: item.consumerIds
    })),
    people: group.people.map(person => ({
      id: person.id,
      name: person.name,
      isCreator: person.isCreator,
      share: fromCents(person.shareCents),
      paid: fromCents(person.paidCents),
      due: fromCents(Math.max(0, person.shareCents - person.paidCents)),
      status: person.status,
      paymentMethod: person.paymentMethod || "",
      reportedAt: person.reportedAt || null,
      paidAt: person.paidAt || null
    })),
    settlements: group.settlements || []
  };
}

function findGroup(database, id) {
  return database.groups.find(group => group.id === id);
}

function findPerson(group, memberId) {
  return group.people.find(person => person.id === memberId);
}

function getDue(person) {
  return Math.max(0, person.shareCents - person.paidCents);
}

function updatePaid(group, person, method) {
  person.paidCents = person.shareCents;
  person.status = "paid";
  person.paymentMethod = method;
  person.paidAt = new Date().toISOString();
  person.reportedAt = null;

  group.settlements.push({
    memberId: person.id,
    memberName: person.name,
    amount: fromCents(person.shareCents),
    method,
    status: "paid",
    date: person.paidAt
  });
}

// -------------------- GROUP CALCULATIONS --------------------

function calculateGroup(data) {
  if (!Array.isArray(data.people) || data.people.length < 2) {
    throw new Error("Add at least two people to create a group.");
  }

  if (!Array.isArray(data.items) || data.items.length === 0) {
    throw new Error("Add at least one bill item.");
  }

  const currency = String(data.currency || DEFAULT_CURRENCY).toUpperCase();

  if (!["INR", "USD"].includes(currency)) {
    throw new Error("Only INR and USD are supported.");
  }

  const people = data.people.map(person => ({
    id: String(person.id || makeId()),
    name: String(person.name || "").trim().slice(0, 60)
  }));

  if (people.some(person => !person.name)) {
    throw new Error("Every person must have a name.");
  }

  if (new Set(people.map(person => person.id)).size !== people.length) {
    throw new Error("Duplicate member IDs are not allowed.");
  }

  if (
    new Set(people.map(person => person.name.toLowerCase())).size !==
    people.length
  ) {
    throw new Error("Each person must have a unique name.");
  }

  const creatorId = String(data.creatorId || data.payerId || "");

  if (!people.some(person => person.id === creatorId)) {
    throw new Error("Select the person who paid the original bill.");
  }

  const shares = {};

  people.forEach(person => {
    shares[person.id] = 0;
  });

  const items = data.items.map(item => {
    const name = String(item.name || "").trim().slice(0, 100);
    const amountCents = toCents(item.amount);

    const consumerIds = [
      ...new Set(
        Array.isArray(item.consumerIds)
          ? item.consumerIds.map(String)
          : []
      )
    ];

    if (!name || amountCents <= 0) {
      throw new Error("Every item needs a name and a positive amount.");
    }

    if (
      consumerIds.length === 0 ||
      consumerIds.some(id => !people.some(person => person.id === id))
    ) {
      throw new Error("Every item must have valid consumers.");
    }

    const allocations = splitCents(amountCents, consumerIds);

    Object.entries(allocations).forEach(([id, amount]) => {
      shares[id] += amount;
    });

    return {
      id: String(item.id || makeId()),
      name,
      amountCents,
      consumerIds
    };
  });

  const subtotalCents = items.reduce(
    (sum, item) => sum + item.amountCents,
    0
  );

  const extraCents = toCents(data.extraAmount || 0);
  const extraMode = data.extraMode === "proportional"
    ? "proportional"
    : "equal";

  const memberIds = people.map(person => person.id);

  const weights = extraMode === "proportional"
    ? memberIds.map(id => shares[id])
    : null;

  const extraAllocations = splitCents(
    extraCents,
    memberIds,
    weights
  );

  Object.entries(extraAllocations).forEach(([id, amount]) => {
    shares[id] += amount;
  });

  const totalCents = subtotalCents + extraCents;

  const finalPeople = people.map(person => ({
    ...person,
    isCreator: person.id === creatorId,
    shareCents: shares[person.id],
    paidCents: person.id === creatorId ? shares[person.id] : 0,
    status: person.id === creatorId ? "paid" : "pending",
    paymentMethod: person.id === creatorId ? "original-bill" : "",
    paidAt: person.id === creatorId ? new Date().toISOString() : null,
    reportedAt: null
  }));

  return {
    id: makeId(),
    title: String(data.title || "Group Bill").trim().slice(0, 100),
    currency,
    totalCents,
    extraCents,
    extraMode,
    creatorId,
    creatorName: people.find(person => person.id === creatorId).name,
    upiId: String(data.upiId || "").trim().slice(0, 100),
    items,
    people: finalPeople,
    settlements: [],
    paypalOrders: [],
    createdAt: new Date().toISOString()
  };
}

// -------------------- GEMINI RECEIPT AI --------------------
async function parseWithGemini(model, prompt, image) {
  const parts = [{ text: prompt }];

  if (image && image.data) {
   parts.push({
  inlineData: {
    mimeType: image.mimeType || "image/jpeg",
    data: image.data
  }
});
  }

  let response;

  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_KEY
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseMimeType: "application/json",
            thinkingConfig: {
              thinkingLevel: "low"
            }
          }
        })
      }
    );
  } catch (err) {
    throw new Error(
      "Could not connect to Gemini AI: " + err.message
    );
  }

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      `Gemini API Error (${response.status}): ${
        result.error?.message || "Unknown API error"
      }`
    );
  }

  const text = result.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("");

  if (!text) {
    throw new Error(
      "Gemini returned no receipt information. Finish reason: " +
      (result.candidates?.[0]?.finishReason || "Unknown")
    );
  }

  try {
    return JSON.parse(
      text.replace(/```json|```/g, "").trim()
    );
  } catch {
    throw new Error(
      "Gemini returned invalid JSON. Please try another receipt image."
    );
  }
}


async function readReceipt(data) {
  if (!GEMINI_KEY) {
    throw new Error("Add GEMINI_API_KEY to your .env file first.");
  }

  const receiptText = String(
    data.text || data.receiptText || ""
  ).trim();

  const image = data.image
    ? {
        data: data.image,
        mimeType: data.mimeType || "image/jpeg"
      }
    : data.imageBase64
      ? {
          data: data.imageBase64,
          mimeType: data.mimeType || "image/jpeg"
        }
      : null;

  if (!receiptText && !image) {
    throw new Error(
      "Provide receipt text or upload a receipt image."
    );
  }

  const prompt = `
Read this restaurant receipt carefully.

Return ONLY valid JSON in this format:
{
  "title": "Restaurant name or Bill",
  "items": [
    { "name": "Item name", "amount": 100.00 }
  ],
  "extraAmount": 0,
  "currency": "INR"
}

Rules:
- Extract individual purchased items and their prices.
- Do not include subtotal, tax, total, discount or payment lines as items.
- Put tax, service charge and other additional charges in extraAmount.
- Do not invent missing values.
- Amounts must be numeric.
- Use INR or USD where identifiable.
- Receipt text:
${receiptText || "Read the attached image."}
`;

  return await parseWithGemini(
    GEMINI_MODEL,
    prompt,
    image
  );
}
// -------------------- PAYPAL HELPERS --------------------

async function paypalToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !secret) {
    throw new Error("PayPal Sandbox credentials are missing.");
  }

  const credentials = Buffer
    .from(`${clientId}:${secret}`)
    .toString("base64");

  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const result = await response.json();

  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description || "PayPal authentication failed.");
  }

  return result.access_token;
}

async function paypalRequest(endpoint, token, method, data) {
  const response = await fetch(`${PAYPAL_BASE_URL}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    ...(data ? { body: JSON.stringify(data) } : {})
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      result.message || result.error_description || "PayPal request failed."
    );
  }

  return result;
}

// -------------------- GROUP ROUTES --------------------

async function createGroup(req, res) {
  const data = await readBody(req);

  try {
    const group = calculateGroup(data);

    const database = readDatabase();
    database.groups.push(group);
    writeDatabase(database);

    const baseUrl = (
      process.env.PUBLIC_BASE_URL ||
      `http://${req.headers.host || `localhost:${PORT}`}`
    ).replace(/\/$/, "");

    const shareUrl =
      `${baseUrl}/?group=${encodeURIComponent(group.id)}`;

    const qrCode = await QRCode.toDataURL(shareUrl, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: "H"
    });

    send(res, 201, {
      success: true,
      group: safeGroup(group),
      shareUrl,
      qrCode
    });
  } catch (err) {
    error(res, 400, err.message);
  }
}

function getGroup(req, res, id) {
  const database = readDatabase();
  const group = findGroup(database, id);

  if (!group) {
    return error(res, 404, "Group not found.");
  }

  send(res, 200, {
    success: true,
    group: safeGroup(group)
  });
}

async function reportPayment(req, res, id) {
  const data = await readBody(req);
  const database = readDatabase();
  const group = findGroup(database, id);

  if (!group) {
    return error(res, 404, "Group not found.");
  }

  const person = findPerson(group, String(data.memberId || ""));

  if (!person || person.isCreator) {
    return error(res, 400, "Invalid group member.");
  }

  if (getDue(person) <= 0 || person.status === "paid") {
    return error(res, 400, "This member has already settled their share.");
  }

  if (person.status === "reported") {
    return error(res, 409, "Payment has already been reported.");
  }

  const method = String(data.method || "upi").toLowerCase();

  if (!["upi", "cash", "other"].includes(method)) {
    return error(res, 400, "Invalid manual payment method.");
  }

  person.status = "reported";
  person.paymentMethod = method;
  person.reportedAt = new Date().toISOString();

  group.settlements.push({
    memberId: person.id,
    memberName: person.name,
    amount: fromCents(getDue(person)),
    method,
    status: "reported",
    date: person.reportedAt
  });

  writeDatabase(database);

  send(res, 200, {
    success: true,
    message: "Payment reported. Waiting for the bill creator's confirmation.",
    group: safeGroup(group)
  });
}

async function confirmPayment(req, res, id, memberId) {
  const data = await readBody(req);
  const database = readDatabase();
  const group = findGroup(database, id);

  if (!group) {
    return error(res, 404, "Group not found.");
  }

  if (String(data.creatorId || "") !== group.creatorId) {
    return error(res, 403, "Only the bill creator can confirm payments.");
  }

  const person = findPerson(group, memberId);

  if (!person || person.isCreator) {
    return error(res, 400, "Invalid group member.");
  }

  if (person.status !== "reported") {
    return error(res, 400, "This member has no pending payment report.");
  }

  updatePaid(group, person, person.paymentMethod || "manual");

  const latest = group.settlements.find(
    item =>
      item.memberId === memberId &&
      item.status === "reported"
  );

  if (latest) {
    latest.status = "paid";
    latest.confirmedAt = new Date().toISOString();
  }

  writeDatabase(database);

  send(res, 200, {
    success: true,
    message: "Payment confirmed.",
    group: safeGroup(group)
  });
}

async function rejectPayment(req, res, id, memberId) {
  const data = await readBody(req);
  const database = readDatabase();
  const group = findGroup(database, id);

  if (!group) {
    return error(res, 404, "Group not found.");
  }

  if (String(data.creatorId || "") !== group.creatorId) {
    return error(res, 403, "Only the bill creator can reject payment reports.");
  }

  const person = findPerson(group, memberId);

  if (!person || person.status !== "reported") {
    return error(res, 400, "No pending payment report found.");
  }

  person.status = "pending";
  person.paymentMethod = "";
  person.reportedAt = null;

  group.settlements.forEach(item => {
    if (item.memberId === memberId && item.status === "reported") {
      item.status = "rejected";
      item.rejectedAt = new Date().toISOString();
    }
  });

  writeDatabase(database);

  send(res, 200, {
    success: true,
    message: "Payment report rejected.",
    group: safeGroup(group)
  });
}

// -------------------- PAYPAL PAYMENT ROUTES --------------------

async function createPaypalOrder(req, res) {
  const data = await readBody(req);
  const database = readDatabase();
  const group = findGroup(database, String(data.groupId || ""));

  if (!group) {
    return error(res, 404, "Group not found.");
  }

  if (group.currency !== "USD") {
    return error(res, 400, "PayPal checkout is enabled for USD groups. Use UPI for INR groups.");
  }

  const person = findPerson(group, String(data.memberId || ""));

  if (!person || person.isCreator) {
    return error(res, 400, "Invalid group member.");
  }

  const dueCents = getDue(person);

  if (dueCents <= 0) {
    return error(res, 400, "There is no pending amount to pay.");
  }

  if (person.status === "reported") {
    return error(res, 400, "A manual payment report is awaiting confirmation.");
  }

  try {
    const token = await paypalToken();

    const order = await paypalRequest(
      "/v2/checkout/orders",
      token,
      "POST",
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            custom_id: `${group.id}:${person.id}`,
            description: `Fair Split - ${group.title}`,
            amount: {
              currency_code: "USD",
              value: fromCents(dueCents).toFixed(2)
            }
          }
        ]
      }
    );

    group.paypalOrders.push({
      orderId: order.id,
      memberId: person.id,
      expectedCents: dueCents,
      currency: "USD",
      status: "created",
      createdAt: new Date().toISOString()
    });

    writeDatabase(database);

    send(res, 200, {
      success: true,
      orderId: order.id
    });
  } catch (err) {
    error(res, 502, err.message);
  }
}

async function capturePaypalOrder(req, res) {
  const data = await readBody(req);
  const orderId = String(data.orderId || "");

  if (!orderId) {
    return error(res, 400, "PayPal order ID is required.");
  }

  const database = readDatabase();

  let group = null;
  let orderRecord = null;

  for (const currentGroup of database.groups) {
    const found = currentGroup.paypalOrders.find(
      order => order.orderId === orderId
    );

    if (found) {
      group = currentGroup;
      orderRecord = found;
      break;
    }
  }

  if (!group || !orderRecord) {
    return error(res, 404, "PayPal order not found.");
  }
  if (orderRecord.status === "completed") {
  return error(res, 409, "This PayPal order has already been captured.");
}

const person = findPerson(group, orderRecord.memberId);

if (!person) {
  return error(res, 404, "Group member not found.");
}

if (person.status === "paid") {
  return error(res, 409, "This member has already paid.");
}

try {
  const token = await paypalToken();

  const capture = await paypalRequest(
    `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    token,
    "POST"
  );

  const purchaseUnit = capture.purchase_units?.[0];
  const payment = purchaseUnit?.payments?.captures?.[0];
  const actualAmount = payment?.amount;

  const expectedCustomId = `${group.id}:${person.id}`;

  if (
    capture.status !== "COMPLETED" ||
    payment?.status !== "COMPLETED" ||
    purchaseUnit?.custom_id !== expectedCustomId ||
    actualAmount?.currency_code !== orderRecord.currency ||
    toCents(actualAmount?.value) !== orderRecord.expectedCents
  ) {
    return error(res, 400, "PayPal payment could not be verified.");
  }

  orderRecord.status = "completed";
  orderRecord.completedAt = new Date().toISOString();

  updatePaid(group, person, "paypal");

  writeDatabase(database);

  send(res, 200, {
    success: true,
    message: "PayPal payment verified successfully.",
    group: safeGroup(group)
  });
} catch (err) {
  error(res, 502, err.message);
}
}

// -------------------- API ROUTER --------------------

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/config") {
    return send(res, 200, {
      success: true,
      currency: DEFAULT_CURRENCY,
      paypalClientId: process.env.PAYPAL_CLIENT_ID || "",
      paypalEnabled: Boolean(
        process.env.PAYPAL_CLIENT_ID &&
        process.env.PAYPAL_CLIENT_SECRET
      )
    });
  }

  if (req.method === "POST" && pathname === "/api/ai/parse-bill") {
    try {
      const data = await readBody(req);
      const result = await readReceipt(data);

      return send(res, 200, {
        success: true,
        ...result
      });
    } catch (err) {
      return error(res, 400, err.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/groups") {
    return createGroup(req, res);
  }

  const groupMatch = pathname.match(/^\/api\/groups\/([a-f0-9]+)$/);

  if (req.method === "GET" && groupMatch) {
    return getGroup(req, res, groupMatch[1]);
  }

  const reportMatch = pathname.match(
    /^\/api\/groups\/([a-f0-9]+)\/report-payment$/
  );

  if (req.method === "POST" && reportMatch) {
    return reportPayment(req, res, reportMatch[1]);
  }

  const confirmMatch = pathname.match(
    /^\/api\/groups\/([a-f0-9]+)\/confirm-payment\/([a-f0-9]+)$/
  );

  if (req.method === "POST" && confirmMatch) {
    return confirmPayment(req, res, confirmMatch[1], confirmMatch[2]);
  }

  const rejectMatch = pathname.match(
    /^\/api\/groups\/([a-f0-9]+)\/reject-payment\/([a-f0-9]+)$/
  );

  if (req.method === "POST" && rejectMatch) {
    return rejectPayment(req, res, rejectMatch[1], rejectMatch[2]);
  }

  if (req.method === "POST" && pathname === "/api/paypal/create-order") {
    return createPaypalOrder(req, res);
  }

  if (req.method === "POST" && pathname === "/api/paypal/capture-order") {
    return capturePaypalOrder(req, res);
  }

  return error(res, 404, "API endpoint not found.");
}

// -------------------- STATIC WEBSITE FILES --------------------

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp"
};

function serveStatic(req, res, pathname) {
  let requestedPath;

  try {
    requestedPath = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400);
    return res.end("Invalid URL.");
  }

  if (requestedPath === "/") {
    requestedPath = "/index.html";
  }

  const filePath = path.resolve(PUBLIC_DIR, "." + requestedPath);

  if (
    !filePath.startsWith(PUBLIC_DIR + path.sep) &&
    filePath !== path.join(PUBLIC_DIR, "index.html")
  ) {
    res.writeHead(403);
    return res.end("Forbidden.");
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end("File not found.");
    }

    const extension = path.extname(filePath).toLowerCase();

    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });

    res.end(content);
  });
}

// -------------------- SERVER --------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      return error(res, 405, "Method not allowed.");
    }

    serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error("Server error:", err);

    if (!res.headersSent) {
      error(res, 500, "Something went wrong on the server.");
    }
  }
});

server.listen(PORT, () => {
  console.log("------------------------------------");
  console.log("       FAIR SPLIT SERVER");
  console.log("------------------------------------");
  console.log(`Website: http://localhost:${PORT}`);
  console.log(`Currency: ${DEFAULT_CURRENCY}`);
  console.log("Group storage: data/groups.json");
  console.log("Server is running.");
});