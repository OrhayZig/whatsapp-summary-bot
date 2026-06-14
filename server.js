import express from "express";
import twilio from "twilio";
import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Config (all secrets come from environment variables — never hard-code them)
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Commands the user types in WhatsApp to control the bot.
const START_COMMAND = "התחל!";
const SUMMARIZE_COMMAND = "סכם!";

// ---------------------------------------------------------------------------
// Session storage
// Keyed by the sender's WhatsApp number. Each session holds the messages
// collected since the user sent "התחל!".
// NOTE: this lives in memory, so it resets if the server restarts. That is
// fine for personal use. (See README for how to make it permanent later.)
// ---------------------------------------------------------------------------
const sessions = new Map();

// ---------------------------------------------------------------------------
// Build the Hebrew summary with Claude
// ---------------------------------------------------------------------------
async function summarizeConversation(messages) {
  const transcript = messages
    .map((m, i) => `${i + 1}. ${m}`)
    .join("\n");

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1500,
    system:
      "אתה עוזר שמסכם שיחות בעברית. קבל רשימת הודעות וצור סיכום ברור ומסודר. " +
      "כלול: (1) הנקודות העיקריות, (2) החלטות שהתקבלו אם יש, (3) משימות ומי אחראי עליהן אם צוין. " +
      "כתוב בעברית תקנית, בקיצור ולעניין. אם אין מידע לקטגוריה מסוימת, דלג עליה.",
    messages: [
      {
        role: "user",
        content: `הנה ההודעות מהשיחה שצריך לסכם:\n\n${transcript}`,
      },
    ],
  });

  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Web server + Twilio webhook
// ---------------------------------------------------------------------------
const app = express();
app.use(express.urlencoded({ extended: false }));

// Simple health check so you can confirm the server is alive in a browser.
app.get("/", (_req, res) => {
  res.send("WhatsApp summary bot is running ✅");
});

// Twilio sends every incoming WhatsApp message here as a POST request.
app.post("/whatsapp", async (req, res) => {
  const from = req.body.From;             // e.g. "whatsapp:+9725..."
  const body = (req.body.Body || "").trim();
  const twiml = new twilio.twiml.MessagingResponse();

  try {
    if (body === START_COMMAND) {
      sessions.set(from, []);
      twiml.message("🟢 התחלתי לתעד את השיחה. שלח 'סכם!' כשתרצה סיכום.");
    } else if (body === SUMMARIZE_COMMAND) {
      const messages = sessions.get(from);
      if (!messages || messages.length === 0) {
        twiml.message(
          "אין שיחה פעילה לתיעוד. שלח 'התחל!' כדי להתחיל לתעד."
        );
      } else {
        const summary = await summarizeConversation(messages);
        sessions.delete(from);
        twiml.message(`📋 *סיכום השיחה:*\n\n${summary}`);
      }
    } else if (sessions.has(from)) {
      // An active session is recording — store the message silently.
      sessions.get(from).push(body);
      // No reply (so the bot stays quiet while recording).
    } else {
      // No active session and not a command — show the instructions.
      twiml.message(
        "👋 הבוט מתעד ומסכם שיחות.\n\n" +
          "• שלח 'התחל!' כדי להתחיל לתעד\n" +
          "• שלח את ההודעות שלך\n" +
          "• שלח 'סכם!' כדי לקבל סיכום בעברית"
      );
    }
  } catch (err) {
    console.error("Error handling message:", err);
    twiml.message("⚠️ קרתה שגיאה. נסה שוב בעוד רגע.");
  }

  res.type("text/xml").send(twiml.toString());
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
