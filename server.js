import express from "express";
import twilio from "twilio";
import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Config (all secrets come from environment variables)
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const twilioClient =
  TWILIO_SID && TWILIO_TOKEN ? twilio(TWILIO_SID, TWILIO_TOKEN) : null;

// The bot's own WhatsApp number (the Twilio sandbox number). We capture it
// from the "To" field of incoming messages so we can send proactive reminders.
let botWhatsAppNumber = process.env.TWILIO_WHATSAPP_NUMBER || null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Pull plain text out of a Claude response.
function textFrom(response) {
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

// WhatsApp messages cap at ~1600 chars — split long replies into chunks.
function splitText(text, size) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks.length ? chunks : [""];
}

// Send a WhatsApp message proactively via the Twilio REST API.
async function sendWhatsApp(to, body) {
  if (!twilioClient || !botWhatsAppNumber) {
    console.error("Cannot send: missing Twilio client or bot number");
    return;
  }
  for (const chunk of splitText(body, 1500)) {
    await twilioClient.messages.create({ from: botWhatsAppNumber, to, body: chunk });
  }
}

// Download Twilio media (requires Basic auth with the account credentials).
async function downloadTwilioMedia(url) {
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw new Error(`Media download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Transcribe an audio buffer with Groq's free Whisper API.
async function transcribeAudio(buffer, contentType) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType || "audio/ogg" }), "audio.ogg");
  form.append("model", "whisper-large-v3");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  return (await res.json()).text;
}

// Ask Claude for a Hebrew summary of some text.
async function summarizeText(text) {
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1000,
    system:
      "אתה מסכם טקסטים בעברית. החזר סיכום קצר וברור: הנקודות העיקריות, " +
      "החלטות ומשימות אם יש. אם הטקסט קצר ממילא, נסח אותו תמציתית.",
    messages: [{ role: "user", content: `סכם את הטקסט הבא:\n\n${text}` }],
  });
  return textFrom(response);
}

// General assistant reply.
async function chatReply(text) {
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1000,
    system:
      "אתה עוזר אישי ידידותי ב-WhatsApp. ענה בעברית, בקצרה ולעניין, אלא אם התבקשת אחרת.",
    messages: [{ role: "user", content: text }],
  });
  return textFrom(response);
}

// Parse a Hebrew reminder request into a delay (seconds) + clean text.
async function parseReminder(text) {
  const nowIsrael = new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" });
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 300,
    system:
      `הזמן הנוכחי בישראל: ${nowIsrael}. ` +
      "המשתמש מבקש תזכורת. החזר אך ורק JSON תקין בפורמט: " +
      '{"delay_seconds": <שניות מעכשיו עד התזכורת>, "reminder_text": "<מה להזכיר>"}. ' +
      "חשב את delay_seconds לפי הזמן הנוכחי. בלי טקסט נוסף, רק ה-JSON.",
    messages: [{ role: "user", content: text }],
  });
  const raw = textFrom(response).trim();
  const jsonStr = raw.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(jsonStr);
}

const isReminder = (text) => /תזכיר|תזכורת|remind/i.test(text);

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const app = express();
app.use(express.urlencoded({ extended: false }));

app.get("/", (_req, res) => res.send("WhatsApp assistant bot is running ✅"));

app.post("/whatsapp", async (req, res) => {
  const from = req.body.From;                       // the user
  const to = req.body.To;                           // the bot's sandbox number
  const body = (req.body.Body || "").trim();
  const numMedia = parseInt(req.body.NumMedia || "0", 10);
  if (to) botWhatsAppNumber = to;                   // remember for reminders

  const twiml = new twilio.twiml.MessagingResponse();

  try {
    // 1) Audio message -> transcribe (handled in background to avoid timeout)
    if (numMedia > 0 && (req.body.MediaContentType0 || "").startsWith("audio")) {
      twiml.message("🎧 קיבלתי הקלטה, מתמלל... רגע אחד.");
      res.type("text/xml").send(twiml.toString());

      (async () => {
        try {
          const buffer = await downloadTwilioMedia(req.body.MediaUrl0);
          const transcript = await transcribeAudio(buffer, req.body.MediaContentType0);
          let reply = `📝 *תמלול:*\n\n${transcript}`;
          if (transcript.length > 600) {
            reply += `\n\n📋 *סיכום:*\n${await summarizeText(transcript)}`;
          }
          await sendWhatsApp(from, reply);
        } catch (e) {
          console.error("Audio processing error:", e);
          await sendWhatsApp(from, "⚠️ לא הצלחתי לתמלל את ההקלטה. נסה שוב.");
        }
      })();
      return;
    }

    // 2) Reminder
    if (body && isReminder(body)) {
      const { delay_seconds, reminder_text } = await parseReminder(body);
      if (delay_seconds && delay_seconds > 0) {
        const when = new Date(Date.now() + delay_seconds * 1000).toLocaleString("he-IL", {
          timeZone: "Asia/Jerusalem",
          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        });
        setTimeout(() => {
          sendWhatsApp(from, `⏰ תזכורת: ${reminder_text}`);
        }, delay_seconds * 1000);
        twiml.message(`✅ אזכיר לך: "${reminder_text}"\n🕐 ב-${when}`);
      } else {
        twiml.message("לא הבנתי מתי להזכיר. נסה: 'תזכיר לי בעוד שעתיים להתקשר לאמא'.");
      }
      res.type("text/xml").send(twiml.toString());
      return;
    }

    // 3) Long text -> summary ; short text -> assistant answer
    if (body) {
      const reply = body.length > 280 ? await summarizeText(body) : await chatReply(body);
      twiml.message(reply);
      res.type("text/xml").send(twiml.toString());
      return;
    }

    // Fallback (e.g. a non-audio attachment, or empty message)
    twiml.message(
      "👋 אני עוזר WhatsApp.\n\n" +
        "• שלח/העבר *הקלטה* → תמלול\n" +
        "• שלח/העבר *טקסט ארוך* → סיכום\n" +
        "• כתוב *'תזכיר לי בעוד שעתיים ל...'* → תזכורת\n" +
        "• שאל אותי כל דבר"
    );
    res.type("text/xml").send(twiml.toString());
  } catch (err) {
    console.error("Error handling message:", err);
    if (!res.headersSent) {
      twiml.message("⚠️ קרתה שגיאה. נסה שוב בעוד רגע.");
      res.type("text/xml").send(twiml.toString());
    }
  }
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// Keep-alive: ping ourselves every 10 min so Render's free tier doesn't sleep
// (sleeping would make reminders unreliable).
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  setInterval(() => {
    fetch(SELF_URL).catch(() => {});
  }, 10 * 60 * 1000);
}
