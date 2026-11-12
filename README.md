FairSplit – Scan. Split. Settle.

FairSplit is an AI-powered bill-splitting web application that makes sharing expenses easier, smarter, and more transparent. It uses Google Gemini AI to extract items from receipts and helps groups divide bills fairly, item by item. Members can access their individual shares through a shared group link or QR code and settle their payments.

Features

- AI-Powered Receipt Scanning: Upload a receipt image and use Google Gemini AI to extract item names and prices automatically.
- Item-Wise Bill Splitting: Assign receipt items to the people who consumed them.
- Fair Share Calculation: Calculate individual contributions, including allocated extra charges.
- Shared Group Settlement: Create a group and generate a shareable link and QR code.
- Individual Payment Details: Members can select their names and view their exact amounts owed.
- Payment Tracking: The creator can monitor paid and pending members.
- UPI Payment Support: Members can report their UPI payments, which the creator must confirm before the status changes to Paid.
- PayPal Sandbox Integration: USD groups can access PayPal checkout to settle their individual shares.
- Currency Selection: Supports INR and USD display and calculations.

How It Works

1. Upload a receipt image.
2. Gemini AI extracts the receipt items and prices.
3. Assign each item to the people who consumed it.
4. Calculate individual shares and allocated extra charges.
5. Create a shared group and generate its QR code and link.
6. Members open the group, select their names, and view their amounts owed.
7. Members proceed with the available payment method.
8. The creator tracks payments and confirms reported UPI payments.

Technology Stack

Technology| Purpose
HTML| Application structure
CSS| Styling and responsive interface
JavaScript| Frontend functionality and interactions
Node.js| Backend and API handling
Google Gemini API| AI-powered receipt image extraction
PayPal Developer Platform| Sandbox checkout and payment integration
PayPal JavaScript SDK| Displays PayPal checkout options
PayPal REST APIs| Creates and captures payment orders
QR Code| Generates shareable group QR codes

Sponsor Technology Integrations

1. Google Gemini AI

FairSplit integrates the Google Gemini API for AI-powered receipt processing. When a user uploads a receipt image, Gemini analyzes the image and extracts item names and their corresponding prices.

This reduces manual data entry and provides structured receipt information for item-wise expense allocation.

2. PayPal Developer Platform

FairSplit integrates the PayPal Developer Platform through its free Sandbox environment.

The integration uses:

- PayPal JavaScript SDK: Loads the PayPal checkout interface.
- PayPal REST APIs: Handles order creation and payment capture.
- Backend Verification: Checks the captured payment details, including order status, currency, expected amount, and group/member association before updating payment status.

PayPal checkout is available for USD groups. Sandbox credentials are used for development and testing.

3. UPI Payment Workflow

For UPI payments, members can report that they have paid. The group creator verifies receipt of the payment and confirms it. Only after confirmation does the member's status change from Pending to Paid.

Getting Started

Prerequisites

- Node.js and npm
- Google Gemini API key
- PayPal Developer Sandbox account

Installation

1. Clone the repository:

git clone YOUR_GITHUB_REPOSITORY_URL

2. Open the project directory:

cd FairSplit

3. Install dependencies:

npm install

4. Create a ".env" file in the project root and configure your API credentials:

GEMINI_API_KEY=your_gemini_api_key
PAYPAL_CLIENT_ID=your_paypal_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_paypal_sandbox_client_secret
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com

Use the Gemini API key variable name expected by your existing backend configuration if it differs from "GEMINI_API_KEY".

5. Start the application:

npm start

6. Open the local application in your browser using the address displayed by the server (for example, "http://localhost:3000").

Important: Never upload your ".env" file or expose API keys, PayPal client secrets, or other credentials in a public repository.

Challenges We Solved

- Extracting structured item information from receipt images.
- Calculating fair individual shares when multiple people consume different items.
- Building a shared group settlement workflow using links and QR codes.
- Maintaining accurate payment statuses through creator confirmation.
- Integrating PayPal Sandbox checkout with backend payment verification.

Future Improvements

- Support for additional payment methods and currencies.
- Improved receipt recognition and extraction accuracy.
- Enhanced payment tracking and settlement history.
- Database integration and improved scalability.
- Further improvements to the user experience.

License

This project is licensed under the MIT License. See the "LICENSE" file for details.

---

FairSplit – Scan. Split. Settle.

Making group expenses simpler, fairer, and easier to manage.
