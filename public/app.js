/* =========================================
   FAIR SPLIT - MAIN APPLICATION
========================================= */

(() => {
  "use strict";

  /* =========================================
     1. ELEMENTS AND APPLICATION STATE
  ========================================= */

  const $ = (id) => document.getElementById(id);

  const state = {
    people: [],
    items: [],
    result: null,
    group: null,
    groupId: null,
    selectedMemberId: null,
    isCreator: false,
    creatorId: null,
    receiptFile: null,
    paypalLoaded: false
  };

  const API = "";

  /* =========================================
     2. GENERAL HELPERS
  ========================================= */

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => {
      const map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      };

      return map[char];
    });
  }

  function currency() {
    return $("currency")?.value || "INR";
  }

  function symbol() {
    return currency() === "USD" ? "$" : "₹";
  }

  function money(cents) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format((Number(cents) || 0) / 100);
  }

  function toCents(amount) {
    const number = Number(amount);

    if (!Number.isFinite(number)) {
      return 0;
    }

    return Math.round(number * 100);
  }

  function setStatus(id, message, isError = false) {
    const element = $(id);

    if (!element) return;

    element.textContent = message;
    element.style.color = isError ? "#ff7373" : "";
  }

  function makeId() {
    return (
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 9)
    );
  }

  function getPerson(id) {
    return state.people.find((person) => person.id === id);
  }

  function splitCents(total, weights) {
    if (!weights.length) return [];

    const positiveWeights = weights.map((weight) =>
      Math.max(0, Number(weight) || 0)
    );

    let sum = positiveWeights.reduce((a, b) => a + b, 0);

    if (sum === 0) {
      sum = weights.length;

      return weights.map((_, index) => {
        const base = Math.floor(total / sum);

        return index < total % sum ? base + 1 : base;
      });
    }

    let used = 0;

    const shares = positiveWeights.map((weight) => {
      const share = Math.floor((total * weight) / sum);

      used += share;

      return share;
    });

    let remaining = total - used;

    for (let i = 0; remaining > 0; i++) {
      if (positiveWeights[i] > 0) {
        shares[i]++;
        remaining--;
      }

      if (i === positiveWeights.length - 1 && remaining > 0) {
        i = -1;
      }
    }

    return shares;
  }

  async function apiRequest(path, options = {}) {
    const response = await fetch(API + path, {
      ...options,
      headers: {
        ...(options.body ? {
          "Content-Type": "application/json"
        } : {}),
        ...(options.headers || {})
      }
    });

    let data = {};

    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      throw new Error(
        data.error || data.message || "Something went wrong."
      );
    }

    return data;
  }

  /* =========================================
     3. PEOPLE MANAGEMENT
  ========================================= */

  function addPerson() {
    const input = $("person");
    const name = input.value.trim();

    if (!name) {
      input.focus();
      return;
    }

    if (
      state.people.some(
        (person) => person.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      setStatus("error", "This person has already been added.", true);
      return;
    }

    state.people.push({
      id: makeId(),
      name
    });

    input.value = "";

    renderPeople();
    renderItems();
    updateSummary();

    setStatus("error", "");
  }

  function removePerson(id) {
    if (state.items.some((item) => item.consumers.includes(id))) {
      const confirmed = window.confirm(
        "This person is assigned to one or more items. Remove them anyway?"
      );

      if (!confirmed) return;
    }

    state.people = state.people.filter(
      (person) => person.id !== id
    );

    state.items.forEach((item) => {
      item.consumers = item.consumers.filter(
        (personId) => personId !== id
      );
    });

    renderPeople();
    renderItems();
    updateSummary();
  }

  function renderPeople() {
    const container = $("people");
    const payer = $("payer");

    if (!container || !payer) return;

    if (!state.people.length) {
      container.innerHTML =
        '<p class="empty-state">No people added yet.</p>';
    } else {
      container.innerHTML = state.people.map((person) => `
        <div class="person-chip">
          <span>${escapeHTML(person.name)}</span>

          <button
            type="button"
            data-remove-person="${person.id}"
            aria-label="Remove ${escapeHTML(person.name)}"
          >×</button>
        </div>
      `).join("");
    }

    const previousPayer = payer.value;

    payer.innerHTML = state.people.length
      ? '<option value="">Select payer</option>' +
        state.people.map((person) => `
          <option value="${person.id}">
            ${escapeHTML(person.name)}
          </option>
        `).join("")
      : '<option value="">Add people first</option>';

    if (
      state.people.some((person) => person.id === previousPayer)
    ) {
      payer.value = previousPayer;
    }
  }

  /* =========================================
     4. ITEM MANAGEMENT
  ========================================= */

  function addItem() {
    const nameInput = $("itemName");
    const amountInput = $("itemAmount");

    const name = nameInput.value.trim();
    const amount = Number(amountInput.value);

    if (!name) {
      setStatus("error", "Enter an item name.", true);
      nameInput.focus();
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setStatus("error", "Enter a valid item amount.", true);
      amountInput.focus();
      return;
    }

    if (!state.people.length) {
      setStatus("error", "Add people before adding bill items.", true);
      return;
    }

    state.items.push({
      id: makeId(),
      name,
      amountCents: toCents(amount),
      consumers: []
    });

    nameInput.value = "";
    amountInput.value = "";

    renderItems();
    updateSummary();

    setStatus("error", "");
  }

  function removeItem(id) {
    state.items = state.items.filter(
      (item) => item.id !== id
    );

    renderItems();
    updateSummary();
  }

  function toggleConsumer(itemId, personId, checked) {
    const item = state.items.find(
      (entry) => entry.id === itemId
    );

    if (!item) return;

    if (checked && !item.consumers.includes(personId)) {
      item.consumers.push(personId);
    } else if (!checked) {
      item.consumers = item.consumers.filter(
        (id) => id !== personId
      );
    }

    updateSummary();
  }

  function renderItems() {
    const container = $("items");

    if (!container) return;

    if (!state.items.length) {
      container.innerHTML = `
        <p class="empty-state">
          No items added yet. Scan a receipt or add items manually.
        </p>
      `;

      return;
    }

    container.innerHTML = state.items.map((item) => `
      <div class="item-card">

        <div class="item-top">

          <div class="item-info">
            <strong>${escapeHTML(item.name)}</strong>

            <span>${money(item.amountCents)}</span>
          </div>

          <div class="item-actions">
            <button
              type="button"
              data-remove-item="${item.id}"
            >Remove</button>
          </div>

        </div>

        <div class="item-consumers">

          ${state.people.map((person) => `
            <label class="consumer-option">

              <input
                type="checkbox"
                data-item-id="${item.id}"
                data-person-id="${person.id}"
                ${item.consumers.includes(person.id) ? "checked" : ""}
              >

              ${escapeHTML(person.name)}

            </label>
          `).join("")}

        </div>

      </div>
    `).join("");
  }

  /* =========================================
     5. FAIR SHARE CALCULATION
  ========================================= */

  function calculateShares() {
    if (!state.people.length) {
      throw new Error("Add at least one person.");
    }

    if (!state.items.length) {
      throw new Error("Add at least one bill item.");
    }

    const shares = {};

    state.people.forEach((person) => {
      shares[person.id] = 0;
    });

    let itemsTotal = 0;

    for (const item of state.items) {
      if (!item.consumers.length) {
        throw new Error(
          `Select at least one person for "${item.name}".`
        );
      }

      const validConsumers = item.consumers.filter(
        (id) => shares[id] !== undefined
      );

      if (!validConsumers.length) {
        throw new Error(
          `No valid consumer found for "${item.name}".`
        );
      }

      const portions = splitCents(
        item.amountCents,
        validConsumers.map(() => 1)
      );

      validConsumers.forEach((id, index) => {
        shares[id] += portions[index];
      });

      itemsTotal += item.amountCents;
    }

    const extraCents = toCents(
      $("extraAmount")?.value || 0
    );

    if (extraCents < 0) {
      throw new Error("Extra charges cannot be negative.");
    }

    if ($("extraMode").value === "equal") {
      const ids = state.people.map((person) => person.id);

      const portions = splitCents(
        extraCents,
        ids.map(() => 1)
      );

      ids.forEach((id, index) => {
        shares[id] += portions[index];
      });
    } else {
      const ids = state.people.map((person) => person.id);

      const portions = splitCents(
        extraCents,
        ids.map((id) => shares[id])
      );

      ids.forEach((id, index) => {
        shares[id] += portions[index];
      });
    }

    const total = itemsTotal + extraCents;

    const result = {
      shares,
      itemsTotal,
      extraCents,
      total
    };

    state.result = result;

    return result;
  }

  /* =========================================
     6. SUMMARY DISPLAY
  ========================================= */

  function updateSummary() {
    const itemsTotal = state.items.reduce(
      (sum, item) => sum + item.amountCents,
      0
    );

    const extraCents = toCents(
      $("extraAmount")?.value || 0
    );

    const total = itemsTotal + extraCents;
    const count = state.people.length;

    $("total").textContent = money(total);
    $("count").textContent = count;

    $("each").textContent = money(
      count ? Math.round(total / count) : 0
    );

    $("heroTotal").textContent = money(total);
    $("heroPeople").textContent = count;
  }

  function renderResults(result) {
    const container = $("shares");
    const payments = $("payments");

    container.innerHTML = state.people.map((person) => `
      <div class="share-card">

        <h4>${escapeHTML(person.name)}</h4>

        <strong>${money(result.shares[person.id])}</strong>

        <p>Individual fair share</p>

      </div>
    `).join("");

    const payerId = $("payer").value;
    const payer = getPerson(payerId);

    payments.innerHTML = state.people
      .filter((person) => person.id !== payerId)
      .map((person) => `
        <div class="payment-row">

          <span>
            ${escapeHTML(person.name)}
            owes ${escapeHTML(payer?.name || "the payer")}
          </span>

          <strong>${money(result.shares[person.id])}</strong>

        </div>
      `).join("");

    $("results").hidden = false;

    $("results").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  function handleCalculation() {
    try {
      const payerId = $("payer").value;

      if (!payerId || !getPerson(payerId)) {
        throw new Error("Select who paid the original bill.");
      }

      const result = calculateShares();

      renderResults(result);

      setStatus("error", "");
    } catch (error) {
      setStatus("error", error.message, true);
    }
  }
  /* =========================================
     7. AI RECEIPT SCANNING
  ========================================= */

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const result = String(reader.result || "");
        resolve(result.split(",")[1] || "");
      };

      reader.onerror = () => {
        reject(new Error("Could not read the receipt image."));
      };

      reader.readAsDataURL(file);
    });
  }

  async function extractReceipt() {
    const button = $("ai");
    const file = state.receiptFile;
    const text = $("receiptText").value.trim();

    if (!file && !text) {
      setStatus(
        "aiStatus",
        "Upload a receipt image or paste receipt text.",
        true
      );
      return;
    }

    button.disabled = true;
    button.textContent = "Extracting...";

    setStatus("aiStatus", "AI is reading your receipt...");

    try {
      const payload = {
        text
      };

      if (file) {
        payload.image = await fileToBase64(file);
        payload.mimeType = file.type;
      }

      const response = await apiRequest(
        "/api/ai/parse-bill",
        {
          method: "POST",
          body: JSON.stringify(payload)
        }
      );

      const extractedItems = response.items || [];

      if (!extractedItems.length) {
        throw new Error("No bill items were detected.");
      }

      let added = 0;

      extractedItems.forEach((entry) => {
        const name = String(entry.name || "").trim();
        const amount = Number(entry.amount);

        if (
          name &&
          Number.isFinite(amount) &&
          amount > 0
        ) {
          state.items.push({
            id: makeId(),
            name,
            amountCents: toCents(amount),
            consumers: []
          });

          added++;
        }
      });

      if (!added) {
        throw new Error("The receipt did not contain valid items.");
      }

      renderItems();
      updateSummary();

      setStatus(
        "aiStatus",
        `${added} items extracted. Now assign consumers to each item.`
      );

    } catch (error) {
      setStatus("aiStatus", error.message, true);

    } finally {
      button.disabled = false;
      button.textContent = "✨ Extract items with AI";
    }
  }

  function handleReceiptFile(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp"
    ];

    if (!allowedTypes.includes(file.type)) {
      setStatus(
        "aiStatus",
        "Please choose a JPG, PNG or WEBP image.",
        true
      );

      event.target.value = "";
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setStatus(
        "aiStatus",
        "Receipt image must be smaller than 10 MB.",
        true
      );

      event.target.value = "";
      return;
    }

    state.receiptFile = file;

    $("fileName").textContent = file.name;

    setStatus("aiStatus", "Receipt image selected.");
  }

  /* =========================================
     8. GROUP CREATION
  ========================================= */

  async function createGroup() {
    const button = $("createGroup");

    if (!state.result) {
      setStatus(
        "groupStatus",
        "Calculate the shares before creating a group.",
        true
      );
      return;
    }

    const payerId = $("payer").value;

    if (!payerId || !getPerson(payerId)) {
      setStatus(
        "groupStatus",
        "Select the person who paid the original bill.",
        true
      );
      return;
    }

    const title = $("title").value.trim();

    if (!title) {
      setStatus(
        "groupStatus",
        "Enter a bill or group name.",
        true
      );
      return;
    }

    button.disabled = true;
    button.textContent = "Creating group...";

    setStatus("groupStatus", "Saving your group...");

    try {
      const payload = {
        title,
        currency: currency(),
        creatorId: payerId,
        upiId: $("upiId").value.trim(),

        people: state.people.map((person) => ({
          id: person.id,
          name: person.name
        })),

        items: state.items.map((item) => ({
          id: item.id,
          name: item.name,
          amount: item.amountCents / 100,
          consumerIds: item.consumers
        })),

        extraAmount: state.result.extraCents / 100,
        extraMode: $("extraMode").value
      };

      const response = await apiRequest(
        "/api/groups",
        {
          method: "POST",
          body: JSON.stringify(payload)
        }
      );

      if (!response.group || !response.group.id) {
        throw new Error("The server did not return a valid group.");
      }

      state.group = response.group;
      state.groupId = response.group.id;
      state.creatorId = payerId;
      state.isCreator = true;

      const link =
        response.shareUrl ||
        `${window.location.origin}${window.location.pathname}?group=${encodeURIComponent(state.groupId)}`;

      $("groupLink").value = link;

      if (response.qrCode) {
        $("groupQR").src = response.qrCode;
      }

      setStatus(
        "groupStatus",
        "Your group has been created successfully!"
      );

      await openGroup(state.groupId, true);

    } catch (error) {
      setStatus("groupStatus", error.message, true);

    } finally {
      button.disabled = false;
      button.textContent = "Create group & generate QR →";
    }
  }

  /* =========================================
     9. GROUP VIEW INITIALIZATION
  ========================================= */

  async function loadGroup(groupId) {
    const response = await apiRequest(
      `/api/groups/${encodeURIComponent(groupId)}`
    );

    if (!response.group) {
      throw new Error("Group not found.");
    }

    return response.group;
  }

  async function openGroup(groupId, creatorView = false) {
    try {
      const group = await loadGroup(groupId);

      state.group = group;
      state.groupId = group.id;

      $("workspace").hidden = true;
      $("groupView").hidden = false;

      $("groupTitle").textContent = group.title;
      $("groupSubtitle").textContent =
        "View individual shares and track group settlements.";

      $("groupTotal").textContent = formatGroupMoney(
        group.totalAmount,
        group.currency
      );

      $("groupCount").textContent = group.people.length;
      $("groupCreator").textContent = group.creatorName || "-";

      renderMemberOptions(group);

      const isCreator =
        creatorView ||
        sessionStorage.getItem(
          `fairSplitCreator_${group.id}`
        ) === group.creatorId;

      state.isCreator = isCreator;

      $("creatorDashboard").hidden = !isCreator;

      if (isCreator) {
        state.creatorId = group.creatorId;

        $("memberSelectPanel").hidden = true;
        $("memberPayment").hidden = true;

        await renderCreatorDashboard();
      } else {
        $("memberSelectPanel").hidden = false;
        $("memberPayment").hidden = true;
      }

      $("groupView").scrollIntoView({
        behavior: "smooth",
        block: "start"
      });

    } catch (error) {
      setStatus("groupError", error.message, true);
    }
  }

  function formatGroupMoney(amount, groupCurrency) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: groupCurrency || "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(amount) || 0);
  }

  function renderMemberOptions(group) {
    const select = $("memberSelect");

    select.innerHTML =
      '<option value="">Select your name</option>' +
      group.people.map((person) => `
        <option value="${escapeHTML(person.id)}">
          ${escapeHTML(person.name)}
        </option>
      `).join("");
  }
  /* =========================================
     10. MEMBER PAYMENT VIEW
  ========================================= */

  function selectMember() {
    const memberId = $("memberSelect").value;

    if (!memberId) {
      setStatus("memberPaymentMessage", "Select your name first.", true);
      return;
    }

    const person = state.group.people.find(
      (entry) => entry.id === memberId
    );

    if (!person) {
      setStatus("memberPaymentMessage", "Member not found.", true);
      return;
    }

    state.selectedMemberId = memberId;

    $("memberPayment").hidden = false;
    $("memberName").textContent = person.name;
    $("memberShare").textContent = formatGroupMoney(
      person.share,
      state.group.currency
    );
    $("memberPaid").textContent = formatGroupMoney(
      person.paid,
      state.group.currency
    );
    $("memberRemaining").textContent = formatGroupMoney(
      person.due,
      state.group.currency
    );
    $("memberDue").textContent = formatGroupMoney(
      person.due,
      state.group.currency
    );
    $("memberPaymentStatus").textContent = person.status.toUpperCase();

    const isPaid = person.status === "paid";
    const isReported = person.status === "reported";

    $("paymentMethods").hidden = isPaid || isReported;
    $("memberPaymentMessage").textContent = "";

    if (isPaid) {
      setStatus(
        "memberPaymentMessage",
        "Your share has been successfully settled."
      );
    } else if (isReported) {
      setStatus(
        "memberPaymentMessage",
        "Your payment has been reported. Waiting for creator confirmation."
      );
    }

    const isINR = state.group.currency === "INR";

    $("upiPayment").hidden = !isINR;
    $("paypalPayment").hidden = isINR || isPaid || isReported;

    $("creatorUpi").textContent = state.group.upiId || "UPI ID not provided";

    if (isINR && !state.group.upiId) {
      setStatus(
        "memberPaymentMessage",
        "The creator has not added a UPI ID. Contact the creator for payment details.",
        true
      );
    }

    if (!isINR && !isPaid && !isReported) {
      loadPaypalButtons().catch((error) => {
        setStatus("memberPaymentMessage", error.message, true);
      });
    }
  }

  /* =========================================
     11. MANUAL PAYMENT REPORT
  ========================================= */

  async function reportManualPayment() {
    if (!state.group || !state.selectedMemberId) return;

    const button = $("reportUpi");

    button.disabled = true;
    button.textContent = "Submitting...";

    try {
      const response = await apiRequest(
        `/api/groups/${encodeURIComponent(state.groupId)}/report-payment`,
        {
          method: "POST",
          body: JSON.stringify({
            memberId: state.selectedMemberId,
            method: "upi"
          })
        }
      );

      state.group = response.group;

      setStatus(
        "memberPaymentMessage",
        "Payment reported. Waiting for the creator's confirmation."
      );

      selectMember();

    } catch (error) {
      setStatus("memberPaymentMessage", error.message, true);

    } finally {
      button.disabled = false;
      button.textContent = "I've made the payment";
    }
  }

  /* =========================================
     12. CREATOR DASHBOARD
  ========================================= */

  async function renderCreatorDashboard() {
    if (!state.group) return;

    const group = state.group;

    const collected = group.people.reduce(
      (sum, person) => sum + toCents(person.paid),
      0
    );

    const pending = group.people.reduce(
      (sum, person) => sum + toCents(person.due),
      0
    );

    const paidCount = group.people.filter(
      (person) => person.status === "paid"
    ).length;

    $("collectedAmount").textContent = formatGroupMoney(
      collected / 100,
      group.currency
    );

    $("pendingAmount").textContent = formatGroupMoney(
      pending / 100,
      group.currency
    );

    $("paidCount").textContent =
      `${paidCount} / ${group.people.length}`;

    const container = $("memberOrders");

    container.innerHTML = group.people.map((person) => {
      const isCreator = person.isCreator;
      const isReported = person.status === "reported";
      const isPaid = person.status === "paid";

      let statusText = "Pending";
      let statusClass = "pending";

      if (isCreator) {
        statusText = "Creator · Already paid";
        statusClass = "paid";
      } else if (isPaid) {
        statusText = "Paid";
        statusClass = "paid";
      } else if (isReported) {
        statusText = "Payment reported";
        statusClass = "reported";
      }

      return `
        <div class="member-order">

          <div class="member-order-info">
            <strong>${escapeHTML(person.name)}</strong>

            <span class="payment-status ${statusClass}">
              ${statusText}
            </span>

            <small>
              Share: ${formatGroupMoney(person.share, group.currency)}
              · Paid: ${formatGroupMoney(person.paid, group.currency)}
              · Due: ${formatGroupMoney(person.due, group.currency)}
            </small>

            ${
              person.paymentMethod
                ? `<small>Method: ${escapeHTML(person.paymentMethod)}</small>`
                : ""
            }

          </div>

          ${
            isReported
              ? `
                <div class="member-order-actions">

                  <button
                    type="button"
                    data-confirm-payment="${escapeHTML(person.id)}"
                  >Confirm</button>

                  <button
                    type="button"
                    data-reject-payment="${escapeHTML(person.id)}"
                  >Reject</button>

                </div>
              `
              : ""
          }

        </div>
      `;
    }).join("");
  }

  /* =========================================
     13. CREATOR PAYMENT CONFIRMATION
  ========================================= */

  async function updateReportedPayment(memberId, action) {
    if (!state.group || !state.creatorId) return;

    const isConfirm = action === "confirm";

    const endpoint = isConfirm
      ? "confirm-payment"
      : "reject-payment";

    const message = isConfirm
      ? "Payment confirmed successfully."
      : "Payment report rejected.";

    try {
      const response = await apiRequest(
        `/api/groups/${encodeURIComponent(state.groupId)}/${endpoint}/${encodeURIComponent(memberId)}`,
        {
          method: "POST",
          body: JSON.stringify({
            creatorId: state.creatorId
          })
        }
      );

      state.group = response.group;

      await renderCreatorDashboard();

      setStatus("groupError", message);

    } catch (error) {
      setStatus("groupError", error.message, true);
    }
  }

  /* =========================================
     14. PAYPAL SDK AND CHECKOUT
  ========================================= */

  async function loadPaypalButtons() {
    if (state.paypalLoaded) {
      renderPaypalButtons();
      return;
    }

    const config = await apiRequest("/api/config");

    if (!config.paypalEnabled || !config.paypalClientId) {
      throw new Error(
        "PayPal is not configured. Add your Sandbox credentials to .env."
      );
    }

    if (!window.paypal) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");

        script.src =
          "https://www.paypal.com/sdk/js?client-id=" +
          encodeURIComponent(config.paypalClientId) +
          "&currency=USD&intent=capture";

        script.onload = resolve;
        script.onerror = () => {
          reject(new Error("Could not load PayPal checkout."));
        };

        document.head.appendChild(script);
      });
    }

    if (!window.paypal) {
      throw new Error("PayPal checkout could not be initialized.");
    }

    state.paypalLoaded = true;

    renderPaypalButtons();
  }

  function renderPaypalButtons() {
    const container = $("paypalButtons");

    if (!container || !window.paypal || !state.selectedMemberId) {
      return;
    }

    container.innerHTML = "";

    window.paypal.Buttons({

      createOrder: async () => {
        const response = await apiRequest(
          "/api/paypal/create-order",
          {
            method: "POST",
            body: JSON.stringify({
              groupId: state.groupId,
              memberId: state.selectedMemberId
            })
          }
        );

        if (!response.orderId) {
          throw new Error("PayPal did not return an order ID.");
        }

        return response.orderId;
      },

      onApprove: async (data) => {
        setStatus(
          "memberPaymentMessage",
          "Verifying your PayPal payment..."
        );

        const response = await apiRequest(
          "/api/paypal/capture-order",
          {
            method: "POST",
            body: JSON.stringify({
              orderId: data.orderID
            })
          }
        );

        if (!response.group) {
          throw new Error("Payment verification failed.");
        }

        state.group = response.group;

        selectMember();

        setStatus(
          "memberPaymentMessage",
          "PayPal payment verified successfully!"
        );
      },

      onError: (error) => {
        setStatus(
          "memberPaymentMessage",
          error.message || "PayPal payment failed. Please try again.",
          true
        );
      }

    }).render("#paypalButtons");
  }
  // ------------------------------
  // EVENT LISTENERS
  // ------------------------------

  // Add person
  $("add").addEventListener("click", addPerson);

  $("person").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addPerson();
    }
  });

  // Remove person
  $("people").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-person]");

    if (button) {
      removePerson(button.dataset.removePerson);
    }
  });

  // Add item
  $("addItem").addEventListener("click", addItem);

  $("itemName").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addItem();
    }
  });

  $("itemAmount").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addItem();
    }
  });

  // Remove items and update consumers
  $("items").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-item]");

    if (button) {
      removeItem(button.dataset.removeItem);
    }
  });

  $("items").addEventListener("change", (event) => {
    const checkbox = event.target.closest(
      'input[data-item-id][data-person-id]'
    );

    if (checkbox) {
      toggleConsumer(
        checkbox.dataset.itemId,
        checkbox.dataset.personId,
        checkbox.checked
      );
    }
  });

  // Update summary when values change
  ["title", "currency", "payer", "upiId", "extraAmount", "extraMode"].forEach(
    (id) => {
      $(id).addEventListener("input", updateSummary);
      $(id).addEventListener("change", updateSummary);
    }
  );

  // Calculate shares
  $("calc").addEventListener("click", handleCalculation);

  // Receipt upload and AI extraction
  $("receiptFile").addEventListener("change", handleReceiptFile);

  $("ai").addEventListener("click", extractReceipt);

  // Create shared group
 $("createGroup").addEventListener("click", async () => {
  await createGroup();

  if (state.groupId) {
    sessionStorage.setItem(
      "fairSplitCreator_" + state.groupId,
      $("payer").value
    );
  }
});
  // Open selected member's payment page
  $("viewMember").addEventListener("click", selectMember);

  $("memberSelect").addEventListener("change", () => {
    $("memberPayment").hidden = true;
  });

  // Report UPI payment
  $("reportUpi").addEventListener("click", reportManualPayment);

  // Copy UPI ID
  $("copyUpi").addEventListener("click", async () => {
    const upi = $("creatorUpi").textContent.trim();

    if (!upi) return;

    try {
      await navigator.clipboard.writeText(upi);
      setStatus("memberPaymentMessage", "UPI ID copied successfully.");
    } catch (error) {
      setStatus("memberPaymentMessage", "Unable to copy UPI ID.", true);
    }
  });

  // Confirm or reject reported payments
  $("memberOrders").addEventListener("click", (event) => {
    const confirmButton = event.target.closest("[data-confirm-payment]");
    const rejectButton = event.target.closest("[data-reject-payment]");

    if (confirmButton) {
      updateReportedPayment(
        confirmButton.dataset.confirmPayment,
        "confirm"
      );
    }

    if (rejectButton) {
      updateReportedPayment(
        rejectButton.dataset.rejectPayment,
        "reject"
      );
    }
  });

  // Copy group link
  $("copyLink").addEventListener("click", async () => {
    const link = $("groupLink").value;

    if (!link) return;

    try {
      await navigator.clipboard.writeText(link);
      setStatus("groupError", "Group link copied successfully.");
    } catch (error) {
      $("groupLink").select();
      setStatus("groupError", "Select and copy the group link manually.");
    }
  });

  // Share group link
  $("shareLink").addEventListener("click", async () => {
    const link = $("groupLink").value;

    if (!link) return;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Fair Split",
          text: "Join my Fair Split group to view your share.",
          url: link
        });
      } catch (error) {
        if (error.name !== "AbortError") {
          setStatus("groupError", "Unable to share the group link.", true);
        }
      }
    } else {
      try {
        await navigator.clipboard.writeText(link);
        setStatus("groupError", "Group link copied. You can share it now.");
      } catch (error) {
        setStatus("groupError", "Unable to share the group link.", true);
      }
    }
  });

  // ------------------------------
  // INITIALIZE APPLICATION
  // ------------------------------

  renderPeople();
  renderItems();
  updateSummary();

  // Load a shared group when its link is opened
  const params = new URLSearchParams(window.location.search);
  const sharedGroupId = params.get("group");

  if (sharedGroupId) {
    openGroup(sharedGroupId);
  }

})();