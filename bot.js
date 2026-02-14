const TelegramBot = require("node-telegram-bot-api");
const { Pool } = require("pg");

const token = process.env.TELEGRAM_TOKEN;
const dbUrl = process.env.DATABASE_URL;

if (!token) throw new Error("Missing TELEGRAM_TOKEN env var");
if (!dbUrl) throw new Error("Missing DATABASE_URL env var");

const bot = new TelegramBot(token, { polling: true });
const pool = new Pool({ connectionString: dbUrl });

// Create tables if they don't exist
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ideas (
      id BIGSERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reminders (
      id BIGSERIAL PRIMARY KEY,
      idea_id BIGINT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
      chat_id BIGINT NOT NULL,
      remind_at TIMESTAMPTZ NOT NULL,
      sent_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_reminders_due
    ON reminders(remind_at)
    WHERE sent_at IS NULL;
  `);
}

async function saveIdea(chatId, userId, text) {
  const r = await pool.query(
    `INSERT INTO ideas (chat_id, user_id, text) VALUES ($1,$2,$3) RETURNING id`,
    [chatId, userId, text]
  );
  return r.rows[0].id;
}

async function listIdeas(chatId, limit = 10) {
  const r = await pool.query(
    `SELECT id, text, created_at FROM ideas WHERE chat_id=$1 ORDER BY created_at DESC LIMIT $2`,
    [chatId, limit]
  );
  return r.rows;
}

function parseDelayToMinutes(s) {
  // supports: 10m, 2h, 3d
  const m = String(s).trim().match(/^(\d+)\s*([mhd])$/i);
  if (!m) return undefined;
  const num = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === "m") return num;
  if (unit === "h") return num * 60;
  if (unit === "d") return num * 24 * 60;
  return undefined;
}

async function createReminderForLastIdea(chatId, delayMinutes) {
  const last = await pool.query(
    `SELECT id, text FROM ideas WHERE chat_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [chatId]
  );
  if (last.rowCount === 0) return { ok: false, reason: "no_ideas" };

  const ideaId = last.rows[0].id;

  const rem = await pool.query(
    `INSERT INTO reminders (idea_id, chat_id, remind_at)
     VALUES ($1,$2, NOW() + ($3 || ' minutes')::interval)
     RETURNING id, remind_at`,
    [ideaId, chatId, String(delayMinutes)]
  );

  return { ok: true, reminder: rem.rows[0] };
}

async function fetchDueReminders(limit = 20) {
  const r = await pool.query(
    `SELECT r.id, r.chat_id, i.text
     FROM reminders r
     JOIN ideas i ON i.id = r.idea_id
     WHERE r.sent_at IS NULL AND r.remind_at <= NOW()
     ORDER BY r.remind_at ASC
     LIMIT $1`,
    [limit]
  );
  return r.rows;
}

async function markReminderSent(reminderId) {
  await pool.query(`UPDATE reminders SET sent_at = NOW() WHERE id=$1`, [
    reminderId,
  ]);
}

// Commands
bot.onText(/^\/start$/, async (msg) => {
  const text =
    "אני שומר כל הודעה כרעיון.\n\n" +
    "פקודות:\n" +
    "/list - 10 רעיונות אחרונים\n" +
    "/remind 10m | 2h | 3d - תזכורת על הרעיון האחרון\n";
  await bot.sendMessage(msg.chat.id, text);
});

bot.onText(/^\/list$/, async (msg) => {
  const ideas = await listIdeas(msg.chat.id, 10);
  if (ideas.length === 0) {
    await bot.sendMessage(msg.chat.id, "אין רעיונות עדיין. שלח הודעה כדי לשמור רעיון.");
    return;
  }
  const lines = ideas.map((x) => `#${x.id} - ${x.text}`);
  await bot.sendMessage(msg.chat.id, lines.join("\n"));
});

bot.onText(/^\/remind\s+(.+)$/i, async (msg, match) => {
  const raw = match[1];
  const minutes = parseDelayToMinutes(raw);
  if (!minutes) {
    await bot.sendMessage(
      msg.chat.id,
      "פורמט לא תקין. דוגמאות: /remind 10m או /remind 2h או /remind 3d"
    );
    return;
  }

  const res = await createReminderForLastIdea(msg.chat.id, minutes);
  if (!res.ok) {
    await bot.sendMessage(msg.chat.id, "אין רעיון אחרון לתזכר עליו. שלח קודם רעיון.");
    return;
  }

  await bot.sendMessage(msg.chat.id, `סבבה. אשלח תזכורת בעוד ${raw}.`);
});

// Save every normal message as an idea (excluding commands)
bot.on("message", async (msg) => {
  const text = (msg.text || "").trim();
  if (!text) return;
  if (text.startsWith("/")) return;

  const id = await saveIdea(msg.chat.id, msg.from.id, text);
  await bot.sendMessage(msg.chat.id, `נשמר. #${id}`);
});

// Reminder worker (runs every minute)
setInterval(async () => {
  try {
    const due = await fetchDueReminders(20);
    for (const r of due) {
      await bot.sendMessage(r.chat_id, `תזכורת: ${r.text}`);
      await markReminderSent(r.id);
    }
  } catch (e) {
    console.error("reminder_worker_error", e);
  }
}, 60 * 1000);

// Boot
(async () => {
  await ensureSchema();
  console.log("Bot running with polling + Postgres");
})();
