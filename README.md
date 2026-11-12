# Fair Split

Fair Split is an AI-powered bill-splitting application that helps friends divide restaurant bills fairly and manage group settlements.

## Features

- AI-powered receipt scanning using Google Gemini.
- Automatic extraction of receipt items.
- Assign individual items to different people.
- Calculate each person's fair share.
- Support for additional charges.
- Create shareable group links and QR codes.
- Individual member payment view.
- Creator dashboard to track paid and pending members.
- Manual UPI payment reporting and confirmation.
- PayPal Sandbox payment integration.
- Persistent group data storage.

## Technologies Used

- HTML
- CSS
- JavaScript
- Node.js
- Google Gemini API
- PayPal Sandbox
- QRCode

## Requirements

- Node.js 18 or later.
- Google Gemini API key.
- PayPal Sandbox credentials (for testing PayPal payments).

## Installation

1. Clone or download this repository.
2. Open the project folder in the terminal.
3. Install dependencies:

   npm install

4. Create a `.env` file in the root folder.
5. Add your configuration:

   PORT=3000
   CURRENCY=USD
   GEMINI_API_KEY=your_actual_api_key
   GEMINI_MODEL=gemini-3.5-flash
   PAYPAL_CLIENT_ID=
   PAYPAL_CLIENT_SECRET=
   PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com

6. Start the application:

   npm start

7. Open your browser:

   http://localhost:3000

## Environment Variables

| Variable | Description |
|---|---|
| PORT | Server port |
| CURRENCY | Default currency |
| GEMINI_API_KEY | Google Gemini API key |
| GEMINI_MODEL | Gemini model |
| PAYPAL_CLIENT_ID | PayPal Sandbox client ID |
| PAYPAL_CLIENT_SECRET | PayPal Sandbox secret |
| PAYPAL_BASE_URL | PayPal Sandbox API URL |
| PUBLIC_BASE_URL | Optional public application URL |

## Security

- Keep `.env` private.
- Never upload API keys or PayPal credentials to GitHub.
- PayPal payment verification is handled on the server.

## Project Structure

FairSplit/
- public/
  - index.html
  - style.css
  - app.js
- server.js
- package.json
- .env
- .env.example
- .gitignore
- README.md

## Project Status

Fair Split is under development.