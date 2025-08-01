require("dotenv").config();
const fs = require('fs');
const express = require('express');
const { Telegraf, Markup } = require("telegraf");
const { Pool } = require('pg');

// --- 1. Initialize Postgres Connection ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // If Render requires it, you can enable SSL like below. Adjust depending on your environment:
  // ssl: { rejectUnauthorized: false },
});

// --- 2. Constants ---
const SHEET_TITLE = "ChainFabric Bot Users"; // kept for semantic continuity but unused now
const CHANNEL_USERNAME = "chainfabric_official";
const CHANNEL_USERNAME2 = "chainfabricnews";
const INSTAGRAM_URL = "https://instagram.com/chainfabric";
const YOUTUBE_URL = "https://youtube.com/@chainfabric";
const ARTICLE_URL = "https://chainfabricnews.blogspot.com/";
const AD_URL = "https://otieu.com/4/9649985";
const WEBHOOK_URL = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`; // dynamic Render domain
const SECRET_PATH = "/telegraf/chainfabric_secret"; // stable path for webhook

// --- 3. Bot Init ---
const bot = new Telegraf(process.env.BOT_TOKEN);

// --- 4. Utility Functions ---
const generateReferralCode = (count) => "USER" + String(count + 1).padStart(3, "0");

function generateSessionCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const nums = '0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
    code += nums[Math.floor(Math.random() * nums.length)];
  }
  return code;
}

// Fetch user row from Postgres
async function getUserRow(telegramId) {
  const res = await pool.query(
    `SELECT * FROM users WHERE telegram_id = $1`,
    [String(telegramId)]
  );
  return res.rows[0];
}

// Create new user with optional referrer (inside transaction context)
async function createUserWithReferral(client, { telegramId, name, username, refCode }) {
  // Count existing users for referral code generation
  const countRes = await client.query(`SELECT COUNT(*) FROM users`);
  const newReferralCode = "USER" + String(parseInt(countRes.rows[0].count, 10) + 1).padStart(3, "0");

  let referredBy = '';
  if (refCode) {
    // Check if referrer exists
    const referrer = (await client.query(`SELECT * FROM users WHERE referral_code = $1`, [refCode])).rows[0];
    if (referrer) {
      referredBy = refCode;
      // Increment referrer metrics
      await client.query(
        `UPDATE users
         SET referrals = referrals + 1,
             balance = balance + 1000
         WHERE referral_code = $1`,
        [refCode]
      );
    }
  }

  await client.query(
    `INSERT INTO users (
       telegram_id, name, username, joined_at, referral_code,
       referred_by, referrals, balance, task_status
     ) VALUES ($1,$2,$3,$4,$5,$6,0,0,'start')`,
    [String(telegramId), name, username, new Date().toISOString(), newReferralCode, referredBy]
  );

  const userRow = (await client.query(`SELECT * FROM users WHERE telegram_id = $1`, [String(telegramId)])).rows[0];
  return userRow;
}

// Generic field updater
async function updateUserField(telegramId, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = [String(telegramId), ...keys.map(k => fields[k])];
  const sql = `UPDATE users SET ${setClauses} WHERE telegram_id = $1`;
  await pool.query(sql, values);
}

// --- 5. Bot Logic ---
const userAdCooldown = new Set();

async function sendTask(ctx, row) {
  const task = row.task_status || "start";
  try {
    if (task === "start") {
      await ctx.reply("📲 Please join our Telegram channels:", Markup.inlineKeyboard([
        Markup.button.url("Join Channel 1", `https://t.me/${CHANNEL_USERNAME}`),
        Markup.button.url("Join Channel 2", `https://t.me/${CHANNEL_USERNAME2}`),
        Markup.button.callback("✅ I’ve Joined", "verify_telegram")
      ]));
    } else if (task === "telegram_done") {
      await ctx.reply("🎉 Telegram Verified!\n+1000 CNFC Points");
      await ctx.reply("📸 Follow our Instagram and enter your username:", Markup.inlineKeyboard([Markup.button.url("Follow Instagram", INSTAGRAM_URL)]));
      await ctx.reply("✍️ Now enter your Instagram username:");
    } else if (task === "instagram_done") {
      await ctx.reply("✅ Instagram Saved!\n+500 CNFC Points");
      await ctx.reply("▶️ Subscribe YouTube and send screenshot:", Markup.inlineKeyboard([Markup.button.url("Subscribe", YOUTUBE_URL)]));
    } else if (task === "youtube_done") {
      await sendProfile(ctx, row);
    }
  } catch (err) {
    console.error(`❌ ERROR in sendTask (${task}):`, err);
  }
}

async function sendProfile(ctx, row) {
  const refLink = `https://t.me/${ctx.botInfo.username}?start=${row.referral_code}`;
  const balance = row.balance || 0;
  const referrals = row.referrals || 0;
  const profileText = `👤 <b>Your Profile</b>\n\n💰 Balance: <b>${balance} CNFC</b>\n👥 Referrals: <b>${referrals}</b>\n🔗 Referral Link:\n${refLink}`;
  await ctx.reply(profileText, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔄 Refresh", callback_data: "refresh_profile" }],
        [{ text: "Watch Ad (+30 Points)", callback_data: "watch_ad" }],
        [{ text: "Read Article (+100 Points)", callback_data: "read_article" }]
      ]
    }
  });
}

// --- 6. Event Handlers ---
bot.start(async (ctx) => {
  const telegramId = String(ctx.from.id);
  const name = ctx.from.first_name || "";
  const username = ctx.from.username || "";
  const refCode = ctx.startPayload || "";

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let userRow = (await client.query(`SELECT * FROM users WHERE telegram_id = $1`, [telegramId])).rows[0];

    if (!userRow) {
      userRow = await createUserWithReferral(client, {
        telegramId,
        name,
        username,
        refCode
      });
    }

    await client.query('COMMIT');

    await sendTask(ctx, userRow);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("❌ ERROR in bot.start:", err);
    ctx.reply("An error occurred. Please try again later.");
  } finally {
    client.release();
  }
});

bot.command('balance', async (ctx) => {
  try {
    const telegramId = String(ctx.from.id);
    const userRow = await getUserRow(telegramId);
    if (userRow) {
      await sendProfile(ctx, userRow);
    } else {
      await ctx.reply("I don't have a record for you yet. Please send /start to begin.");
    }
  } catch (err) {
    console.error("❌ ERROR in /balance command:", err);
    await ctx.reply("An error occurred while fetching your balance.");
  }
});

bot.action("verify_telegram", async (ctx) => {
  try {
    const telegramId = String(ctx.from.id);
    let userRow = await getUserRow(telegramId);

    if (!userRow) {
      // create fallback user without referrer
      userRow = await createUserWithReferral(await pool.connect(), {
        telegramId,
        name: ctx.from.first_name || "",
        username: ctx.from.username || "",
        refCode: ""
      });
    }

    if (userRow.task_status !== "start") {
      return ctx.answerCbQuery("You have already completed this step.");
    }

    await updateUserField(telegramId, {
      task_status: 'telegram_done',
      balance: (parseInt(userRow.balance || 0, 10) + 1000)
    });

    const updatedRow = await getUserRow(telegramId);
    await sendTask(ctx, updatedRow);
    await ctx.answerCbQuery();
  } catch (err) {
    console.error("❌ ERROR in verify_telegram:", err);
    await ctx.answerCbQuery("An error occurred. Please try again.", { show_alert: true });
  }
});

bot.on("text", async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;

  try {
    const telegramId = String(ctx.from.id);
    const text = ctx.message.text.trim();
    const row = await getUserRow(telegramId);
    if (!row) return ctx.reply("❌ You need to /start first.");

    if (row.article_session_id && row.article_session_id === text) {
      await updateUserField(telegramId, {
        balance: (parseInt(row.balance || 0, 10) + 100),
        article_session_id: ''
      });
      await ctx.reply("✅ Success! You've earned +100 CNFC Points. Click /balance or Refresh to see your updated balance.");
    } else if (row.task_status === "telegram_done") {
      await updateUserField(telegramId, {
        instagram_username: text,
        task_status: "instagram_done",
        balance: (parseInt(row.balance || 0, 10) + 500)
      });
      const updatedRow = await getUserRow(telegramId);
      await sendTask(ctx, updatedRow);
    }
  } catch (err) {
    console.error("❌ ERROR in bot.on('text'):", err);
  }
});

bot.on("photo", async (ctx) => {
  try {
    const telegramId = String(ctx.from.id);
    const row = await getUserRow(telegramId);
    if (!row) return ctx.reply("❌ You need to /start first.");

    if (row.task_status === "instagram_done") {
      await updateUserField(telegramId, {
        youtube_verified: "✅ Yes",
        task_status: "youtube_done",
        balance: (parseInt(row.balance || 0, 10) + 500)
      });

      await ctx.reply("✅ YouTube subscription verified.\n\n+500 CNFC Points");
      await ctx.reply("🎉 Thanks for joining ChainFabric!\n\nYou can earn minimum 2000 CNFC points and there's no limit to how much you can earn. Share your referral link to earn +1000 CNFC per signup. All rewards will be claimable on 16th August 2025.");

      const updatedRow = await getUserRow(telegramId);
      await sendTask(ctx, updatedRow);
    }
  } catch (err) {
    console.error("❌ ERROR in bot.on('photo'):", err);
  }
});

bot.action("refresh_profile", async (ctx) => {
  try {
    const telegramId = String(ctx.from.id);
    const row = await getUserRow(telegramId);
    if (!row) return ctx.answerCbQuery("❌ You need to /start first.", { show_alert: true });

    await sendProfile(ctx, row);
    await ctx.answerCbQuery();
  } catch (err) {
    if (!err.description?.includes('message is not modified')) {
      console.error("❌ ERROR in refresh_profile:", err);
    }
    await ctx.answerCbQuery("Data is already up to date.");
  }
});

bot.action("watch_ad", async (ctx) => {
  const telegramId = String(ctx.from.id);
  if (userAdCooldown.has(telegramId)) {
    return ctx.answerCbQuery("Please wait at least 1 minute before watching another ad.", { show_alert: true });
  }

  await ctx.answerCbQuery();
  await ctx.reply("⚠️ <b>Disclaimer:</b> We are not responsible for ad content. Avoid clicking suspicious links.", { parse_mode: "HTML" });
  await ctx.reply("Watch this ad for 1 minute, then click the confirmation button.", Markup.inlineKeyboard([
    [Markup.button.url("📺 Watch Ad", AD_URL)],
    [Markup.button.callback("✅ I Watched the Ad", "claim_ad_reward")]
  ]));
});

bot.action("claim_ad_reward", async (ctx) => {
  const telegramId = String(ctx.from.id);
  if (userAdCooldown.has(telegramId)) {
    return ctx.answerCbQuery("You’ve recently claimed this reward. Please wait.", { show_alert: true });
  }

  try {
    const row = await getUserRow(telegramId);
    if (row) {
      await updateUserField(telegramId, {
        balance: (parseInt(row.balance || 0, 10) + 30)
      });
      userAdCooldown.add(telegramId);
      setTimeout(() => userAdCooldown.delete(telegramId), 60000);
      await ctx.editMessageText("✅ Thanks for watching! You've earned +30 CNFC Points. Click /balance or Refresh to see your updated balance.");
      await ctx.answerCbQuery("Reward claimed!");
    } else {
      await ctx.answerCbQuery("Could not find your user data. Please /start the bot again.", { show_alert: true });
    }
  } catch (err) {
    console.error("❌ ERROR in claim_ad_reward:", err);
    await ctx.answerCbQuery("An error occurred while claiming reward.", { show_alert: true });
  }
});

bot.action("read_article", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("⏳ Generating your unique session code...");

  try {
    const telegramId = String(ctx.from.id);
    const row = await getUserRow(telegramId);
    if (row) {
      const sessionCode = generateSessionCode();
      await updateUserField(telegramId, {
        article_session_id: sessionCode
      });
      const articleLink = `${ARTICLE_URL}?session=${sessionCode}`;

      await ctx.replyWithHTML(
        `<b>Steps:</b>\n\n1. Click to open the article below.\n2. Read it for 2 minutes.\n3. Copy the session ID shown at the bottom.\n4. Paste it here to earn +100 CNFC Points.`,
        Markup.inlineKeyboard([[Markup.button.url("📰 Read Article", articleLink)]])
      );
    } else {
      await ctx.reply("Could not find your user data. Please /start again.");
    }
  } catch (err) {
    console.error("❌ ERROR generating article session:", err);
    await ctx.reply("Something went wrong. Please try again.");
  }
});

// --- 7. Webhook & Server Setup ---
const app = express();

// Logging middleware
app.use((req, res, next) => {
  console.log(`📩 ${req.method} ${req.url}`);
  next();
});

app.use(bot.webhookCallback(SECRET_PATH));

app.get('/', (req, res) => {
  res.send("🤖 CNFC Telegram Bot is running!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  try {
    const fullWebhookURL = `${WEBHOOK_URL}${SECRET_PATH}`;
    await bot.telegram.setWebhook(fullWebhookURL);
    const info = await bot.telegram.getWebhookInfo();
    console.log("✅ Webhook set to:", info.url);
    console.log("Webhook Info:", info);
    console.log(`🚀 Server ready at ${WEBHOOK_URL} on port ${PORT}`);
  } catch (err) {
    console.error("❌ Failed to set webhook:", err.message);
  }
});

// --- 8. Graceful Shutdown ---
process.on('SIGTERM', () => {
  pool.end().then(() => {
    console.log('Postgres pool has ended');
    process.exit(0);
  });
});
process.on('SIGINT', () => {
  pool.end().then(() => {
    console.log('Postgres pool has ended (SIGINT)');
    process.exit(0);
  });
});
