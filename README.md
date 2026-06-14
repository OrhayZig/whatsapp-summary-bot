# WhatsApp Summary Bot 🤖

A personal WhatsApp bot that records a conversation and gives you a clean
Hebrew summary on demand.

**How you use it (from your phone):**
- Send `התחל!` → the bot starts recording
- Send your messages → the bot stays silent and saves them
- Send `סכם!` → the bot replies with a Hebrew summary (key points, decisions, tasks)

You set it up once from your laptop. After that it runs 24/7 in the cloud and
you control it entirely from WhatsApp.

---

## What you'll need (all free to start)

1. A **GitHub** account → https://github.com (stores the code)
2. A **Render** account → https://render.com (runs the code, free tier)
3. An **Anthropic / Claude** account → https://console.anthropic.com (the AI)
4. A **Twilio** account → https://twilio.com (connects to WhatsApp)

You do NOT need to install anything on your laptop. Everything is done in the browser.

---

## Step 1 — Get your Claude API key

1. Go to https://console.anthropic.com and sign in.
2. Add a payment method and a little credit (Billing). Summaries cost fractions
   of a cent each.
3. Open **API Keys** → **Create Key**. Copy the key (starts with `sk-ant-...`).
   Keep it somewhere safe — you'll paste it into Render later.

---

## Step 2 — Put the code on GitHub

This repo already contains the code. If you're reading this, Step 2 is done. ✅

---

## Step 3 — Deploy on Render

1. Go to https://dashboard.render.com and sign in with GitHub.
2. Click **New +** → **Web Service**.
3. Connect the `whatsapp-summary-bot` repository.
4. Fill in:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Open the **Environment** section and add these variables:
   - `ANTHROPIC_API_KEY` = your `sk-ant-...` key from Step 1
   - (optional) `CLAUDE_MODEL` = `claude-sonnet-4-6`
6. Click **Create Web Service** and wait for it to deploy (a few minutes).
7. When it's live, copy the URL at the top — it looks like
   `https://whatsapp-summary-bot-xxxx.onrender.com`.
   Open it in a browser; you should see "WhatsApp summary bot is running ✅".

Your webhook address is that URL + `/whatsapp`, for example:
`https://whatsapp-summary-bot-xxxx.onrender.com/whatsapp`

---

## Step 4 — Connect WhatsApp via Twilio

1. Go to https://console.twilio.com and sign in.
2. Go to **Messaging → Try it out → Send a WhatsApp message**.
   This opens the **WhatsApp Sandbox** (free, perfect for personal use).
3. From your phone, send the given code (e.g. `join something-word`) to the
   Twilio WhatsApp number. Now your phone is linked.
4. In the sandbox settings find **"When a message comes in"**.
   Paste your webhook URL there: `https://...onrender.com/whatsapp`
   Method: **POST**. Save.

---

## Step 5 — Try it 🎉

From WhatsApp, message the Twilio sandbox number:

```
התחל!
היום סיכמנו עם הספק על מחיר חדש
דנה תכין הצעת מחיר עד יום חמישי
צריך לבדוק גם אפשרות למשלוח מהיר
סכם!
```

The bot replies with a Hebrew summary. Done!

---

## Notes & limits

- **Free Render tier sleeps** after ~15 minutes of no traffic. The first message
  after a nap may take ~30–60 seconds while it wakes up. That's normal.
- **Sessions are in memory.** If Render restarts mid-recording, the recording is
  lost. For personal use this is fine.
- **Twilio sandbox** is free but the link expires after a few days of inactivity;
  just re-join with the code. For a permanent number you'd request a Twilio
  WhatsApp Business number later.

## Ideas for later
- Tag who said what
- Email the summary to yourself
- A 📌 command for a mid-conversation interim summary
- Choose summary style (short / detailed / task list)
