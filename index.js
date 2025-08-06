require("dotenv").config();
const fs = require('fs');
const express = require('express');
const { Telegraf, Markup } = require("telegraf");
const { Pool } = require('pg');

// --- 1. Initialize Postgres Connection ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// --- 2. Constants ---
const CHANNEL_USERNAME = "chainfabric_official";
const CHANNEL_USERNAME2 = "chainfabricnews";
const INSTAGRAM_URL = "https://instagram.com/chainfabric";
const YOUTUBE_URL = "https://youtube.com/@chainfabric";
const ARTICLE_URL = "https://chainfabricnews.blogspot.com/";
const AD_URL = "https://otieu.com/4/9649985";
const WEBHOOK_URL = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
const SECRET_PATH = "/telegraf/chainfabric_secret";
const REQUIRED_CHANNELS = [
  { id: process.env.CHANNEL_ID_1, username: CHANNEL_USERNAME },
  { id: process.env.CHANNEL_ID_2, username: CHANNEL_USERNAME2 }
];

// --- 3. Bot Init ---
const bot = new Telegraf(process.env.BOT_TOKEN);

// --- 4. Utility Functions ---
function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const nums = '0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  for (let i = 0; i < 4; i++) code += nums[Math.floor(Math.random() * nums.length)];
  return code;
}

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

async function getUserRow(telegramId) {
  const res = await pool.query(`SELECT * FROM users WHERE telegram_id = $1`, [String(telegramId)]);
  return res.rows[0];
}

async function createUserWithReferral(client, { telegramId, name, username, refCode }) {
  let newReferralCode;
  while (true) {
    const tempCode = generateReferralCode();
    const existing = await client.query(`SELECT 1 FROM users WHERE referral_code = $1`, [tempCode]);
    if (existing.rowCount === 0) {
      newReferralCode = tempCode;
      break;
    }
  }

  let referredBy = '';
  if (refCode) {
    const referrer = (await client.query(`SELECT * FROM users WHERE referral_code = $1`, [refCode])).rows[0];
    if (referrer) {
      referredBy = refCode;
      await client.query(
        `UPDATE users SET referrals = referrals + 1, balance = balance + 1000 WHERE referral_code = $1`,
        [refCode]
      );
    }
  }

  await client.query(
    `INSERT INTO users (telegram_id, name, username, joined_at, referral_code, referred_by, referrals, balance, task_status)
     VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 'start')`,
    [String(telegramId), name, username, new Date().toISOString(), newReferralCode, referredBy]
  );

  const userRow = (await client.query(`SELECT * FROM users WHERE telegram_id = $1`, [String(telegramId)])).rows[0];
  return userRow;
}

async function updateUserField(telegramId, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = [String(telegramId), ...keys.map(k => fields[k])];
  const sql = `UPDATE users SET ${setClauses} WHERE telegram_id = $1`;
  await pool.query(sql, values);
}

async function checkChannelMembership(ctx) {
  let notJoined = [];
  for (const channel of REQUIRED_CHANNELS) {
    if (!channel.id) continue;
    try {
      const member = await ctx.telegram.getChatMember(channel.id, ctx.from.id);
      if (!['member', 'administrator', 'creator'].includes(member.status)) {
        notJoined.push(`@${channel.username}`);
      }
    } catch (e) {
      console.error(`Error checking membership for user ${ctx.from.id} in channel ${channel.id}:`, e.message);
      notJoined.push(`@${channel.username}`);
    }
  }

  if (notJoined.length > 0) {
    await ctx.reply(`You must be a member of all required channels to use the bot. Please rejoin: ${notJoined.join(', ')}`);
    return false;
  }
  return true;
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
    let userRow = await getUserRow(telegramId);
    if (!userRow) {
      userRow = await createUserWithReferral(client, { telegramId, name, username, refCode });
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
    if (!(await checkChannelMembership(ctx))) return;
    const userRow = await getUserRow(String(ctx.from.id));
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
    await ctx.answerCbQuery("Verifying your membership...");
    if (!(await checkChannelMembership(ctx))) return;

    let userRow = await getUserRow(telegramId);
    if (!userRow) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        userRow = await createUserWithReferral(client, { telegramId, name: ctx.from.first_name || "", username: ctx.from.username || "", refCode: "" });
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
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
  } catch (err) {
    console.error("❌ ERROR in verify_telegram:", err);
    await ctx.reply("An error occurred during verification. Please try again.");
  }
});

bot.on("text", async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  try {
    if (!(await checkChannelMembership(ctx))) return;
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
      const existingUser = (await pool.query(`SELECT * FROM users WHERE instagram_username = $1`, [text])).rows[0];
      if (existingUser) {
        return ctx.reply("This Instagram username has already been registered. Please enter a different one.");
      }

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
    if (!(await checkChannelMembership(ctx))) return;
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
    if (!(await checkChannelMembership(ctx))) return ctx.answerCbQuery("Please rejoin our channels to refresh your profile.", { show_alert: true });
    const row = await getUserRow(String(ctx.from.id));
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
  if (!(await checkChannelMembership(ctx))) return ctx.answerCbQuery("Please rejoin our channels to watch an ad.", { show_alert: true });
  const telegramId = String(ctx.from.id);
  if (userAdCooldown.has(telegramId)) return ctx.answerCbQuery("Please wait at least 1 minute before watching another ad.", { show_alert: true });

  await ctx.answerCbQuery();
  await ctx.reply("⚠️ <b>Disclaimer:</b> We are not responsible for ad content. Avoid clicking suspicious links.", { parse_mode: "HTML" });
  await ctx.reply("Watch this ad for 1 minute, then click the confirmation button.", Markup.inlineKeyboard([
    [Markup.button.url("📺 Watch Ad", AD_URL)],
    [Markup.button.callback("✅ I Watched the Ad", "claim_ad_reward")]
  ]));
});

bot.action("claim_ad_reward", async (ctx) => {
  const telegramId = String(ctx.from.id);
  try {
    if (!(await checkChannelMembership(ctx))) return ctx.answerCbQuery("Please rejoin our channels to claim rewards.", { show_alert: true });
    if (userAdCooldown.has(telegramId)) return ctx.answerCbQuery("You’ve recently claimed this reward. Please wait.", { show_alert: true });

    const row = await getUserRow(telegramId);
    if (row) {
      await updateUserField(telegramId, { balance: (parseInt(row.balance || 0, 10) + 30) });
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
  try {
    if (!(await checkChannelMembership(ctx))) return ctx.answerCbQuery("Please rejoin our channels to read an article.", { show_alert: true });
    await ctx.answerCbQuery();
    const telegramId = String(ctx.from.id);
    const row = await getUserRow(telegramId);
    if (row) {
      const sessionCode = generateSessionCode();
      await updateUserField(telegramId, { article_session_id: sessionCode });
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
