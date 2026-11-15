# imastik — Render Edition

Custom stickers web app rebuilt as a clean Node.js/Express service ready for [Render](https://render.com).

## Features

- **Render-ready Node.js Web Service** (`server.js`, `render.yaml`, `GET /health` health check, Helmet CSP, gzip compression).
- **Streamlined imastik Experience** (`public/index.html`, `public/css/styles.css`, `public/js/`):
  - Sunny yellow & pink palette + `Fredoka` & `Playfair Display` typography, `imastik` peel-bulb logo, animated hero ornaments (sun orb, orbit star, scribble), and smiley star pointer cursor (automatically pauses for the pencil cursor on sketch canvases)
  - **Landing Hero** (`#top`) with animated ticker bar
  - **Your Idea. Our Design. Your Stickers.** (`#why-sticky`) featuring a visual 4-step process infographic (`Share your idea` → `We design it` → `Review & approve` → `Printed & yours`)
  - **Pack Pricing** (`#prices`) with interactive copy-tier cards (`5 copies €5`, `10 copies €8`, `20 copies €15`)
  - **Order System** (`#order`) with reference image upload, **napkin sketch canvas** (with pencil cursor + expandable full-screen drawing pad), **voice note recorder**, clear pack/payment instructions (`imastik.co@gmail.com`), and **timelapse / store consent**
- **Flexible Order Submission & Auto-Email Delivery**:
  - Uses `ORDER_MODE=auto`: switches automatically to 1-click direct submission (`POST /api/orders` -> automatic email with photo, sketch & voice attachments to `TEAM_EMAIL`) whenever `GMAIL_WEBHOOK_URL`, `BREVO_API_KEY`, or `RESEND_API_KEY` is configured, and safely falls back to `mailto` drafts if no email provider is set yet.
  - Because Render Free blocks outbound SMTP ports (`25`, `465`, `587`), automatic delivery sends over **HTTPS (port 443)** via a ready-to-deploy [`scripts/google-apps-script.gs`](./scripts/google-apps-script.gs) webhook or Brevo / Resend HTTP APIs.

## Run Locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

Run the test suite:

```bash
npm test
```

## Deploy on Render

1. Push this repository to GitHub or GitLab.
2. In the Render dashboard, choose **New → Blueprint** (or **New → Web Service**) and point to your repo — Render reads [`render.yaml`](./render.yaml) automatically.
3. In Render **Environment** settings, set:
   - `TEAM_EMAIL` — your team's inbox address (`imastik.co@gmail.com`).
   - `ORDER_MODE` — `auto` (recommended: auto-emails orders directly once an email transport is added; safely uses `mailto` beforehand), `server`, or `mailto`.
   - **Automatic Email Delivery (choose one HTTPS transport):**
     - **Option A — Google Apps Script inside `imastik.co@gmail.com` (recommended, free, no domain needed):** Deploy [`scripts/google-apps-script.gs`](./scripts/google-apps-script.gs) at [script.google.com](https://script.google.com) as a Web App (`Execute as: Me`, `Who has access: Anyone`) and set `GMAIL_WEBHOOK_URL` (and optional `GMAIL_WEBHOOK_SECRET`).
     - **Option B — Brevo or Resend API:** Set `BREVO_API_KEY` or `RESEND_API_KEY` (plus `SENDER_EMAIL` if using a custom domain).
   - `ADMIN_PASSWORD` — generated automatically by `render.yaml` to protect `GET /api/orders`.
