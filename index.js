require("dotenv").config();
const fs = require('fs');
const { Telegraf, Markup } = require("telegraf");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const express = require('express');

// --- 1. Cleaned Up Credential Loading ---
let googleCreds;
try {
  const credsPath = process.env.GOOGLE_CREDS_PATH || './creds.json';
  const rawData = fs.readFileSync(credsPath, 'utf8');
  googleCreds = JSON.parse(rawData);
  // This log helps confirm that your Render server is loading the correct file
  console.log(`✅ Credentials successfully loaded for project: ${googleCreds.project_id}`);
} catch (err) {
  console.error("❌ FATAL: Could not read or parse Google credentials. Check your creds.json file and GOOGLE_CREDS_PATH environment variable.", err.message);
  process.exit(1);
}

// --- 2. Express Server Setup ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => {
  res.send('CNFC Telegram Bot is running.');
});
app.listen(port, () => {
  console.log(`✅ Web server listening on port ${port}`);
});

// --- 3. Bot and Google Sheet Initialization ---
const bot = new Telegraf(process.env.BOT_TOKEN);
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);

// --- 4. Constants ---
const CHANNEL_USERNAME = "chainfabric_official";
const CHANNEL_USERNAME2 = "chainfabricnews";
const INSTAGRAM_URL = "https://instagram.com/chainfabric";
const YOUTUBE_URL = "https://youtube.com/@chainfabric";

// --- 5. Helper Functions ---
const generateReferralCode = (count) => "USER" + String(count + 1).padStart(3, "0");

async function getUserRow(sheet, telegramId) {
  const rows = await sheet.getRows();
  return rows.find((row) => row.TelegramID === String(telegramId));
}

// --- 6. The `/test` command for easy debugging ---
bot.command('test', async (ctx) => {
  try {
    console.log(`[TEST] Received /test command from user ${ctx.from.id}.`);
    const refLink = `https://t.me/${ctx.botInfo.username}?start=TESTCODE123`;
    await ctx.reply(
      `This is a <b>test message</b>.\n\nIf you see this, the bot is working correctly.`,
      {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.url("🔗 Test Referral Link", refLink)],
        ])
      }
    );
    console.log(`[TEST] Successfully sent test message to user ${ctx.from.id}.`);
  } catch (err) {
    console.error("❌ [TEST] FAILED to send test message:", err);
    ctx.reply("The /test command failed. Check the server logs for an error.");
  }
});


// --- 7. Main Bot Logic with Error Handling ---

async function sendTask(ctx, row) {
  const task = row.TaskStatus || "start";

  try {
    if (task === "start") {
      await ctx.reply("📲 Please join our Telegram channels:", Markup.inlineKeyboard([
        Markup.button.url("Join Channel 1", `https://t.me/${CHANNEL_USERNAME}`),
        Markup.button.url("Join Channel 2", `https://t.me/${CHANNEL_USERNAME2}`),
        Markup.button.callback("✅ I’ve Joined", "verify_telegram")
      ]));
    } else if (task === "telegram_done") {
      await ctx.reply("🎉 Telegram Join Verified!\n\n+1000 CNFC Points");
      await ctx.reply("📸 Follow our Instagram and enter your username:", Markup.inlineKeyboard([Markup.button.url("Follow Instagram", INSTAGRAM_URL)]));
      await ctx.reply("✍️ Now enter your Instagram username:");
    } else if (task === "instagram_done") {
      await ctx.reply("✅ Instagram Username Saved!\n\n+500 CNFC Points");
      await ctx.reply("▶️ Subscribe our YouTube and send screenshot proof:", Markup.inlineKeyboard([Markup.button.url("Subscribe YouTube", YOUTUBE_URL)]));
    } else if (task === "youtube_done") {
      const refLink = `https://t.me/${ctx.botInfo.username}?start=${row.ReferralCode}`;
      const balance = row.Balance || 0;
      const referrals = row.Referrals || 0;
      await ctx.reply(
        `🎉 All tasks completed!\n\n👤 <b>Your Profile</b>\n\n💰 Balance: <b>${balance} CNFC</b>\n👥 Referrals: <b>${referrals}</b>`,
        {
          parse_mode: "HTML",
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.url("🔗 Share Referral Link", refLink)],
            [Markup.button.callback("🔄 Refresh", "refresh_profile")],
            [Markup.button.callback("🆕 New Task", "new_task")]
          ])
        }
      );
    }
  } catch (err) {
    console.error(`❌ ERROR in sendTask for task "${task}":`, err);
  }
}

bot.start(async (ctx) => {
  console.log(`User ${ctx.from.id} started the bot.`);
  try {
    const telegramId = ctx.from.id;
    const name = ctx.from.first_name || "";
    const username = ctx.from.username || "";
    const refCode = ctx.startPayload || "";

    await doc.useServiceAccountAuth(googleCreds);
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle["ChainFabric Bot Users"];
    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();

    let userRow = await getUserRow(sheet, telegramId);

    if (!userRow) {
      console.log(`Creating new user entry for ${telegramId}.`);
      const newReferralCode = generateReferralCode(rows.length);
      let referredBy = "";
      let referrerRow = null;

      if (refCode) {
        referrerRow = rows.find((r) => r.ReferralCode === refCode);
        if (referrerRow) {
          referredBy = refCode;
        }
      }

      userRow = await sheet.addRow({
        TelegramID: telegramId, Name: name, Username: username,
        JoinedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        ReferralCode: newReferralCode, ReferredBy: referredBy,
        Referrals: 0, Balance: 0, TaskStatus: "start"
      });

      if (referrerRow) {
        referrerRow.Referrals = parseInt(referrerRow.Referrals || 0) + 1;
        referrerRow.Balance = parseInt(referrerRow.Balance || 0) + 1000;
        await referrerRow.save();
      }
    }
    await sendTask(ctx, userRow);
  } catch (err) {
    console.error("❌ ERROR in bot.start:", err);
    ctx.reply("Sorry, there was an error connecting to our services. Please try again later.");
  }
});

bot.action("verify_telegram", async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    await doc.useServiceAccountAuth(googleCreds);
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle["ChainFabric Bot Users"];
    const row = await getUserRow(sheet, telegramId);

    if (!row) return ctx.answerCbQuery("❌ You need to /start first.", { show_alert: true });
    if (row.TaskStatus !== "start") return ctx.answerCbQuery();

    row.TaskStatus = "telegram_done";
    row.Balance = parseInt(row.Balance || 0) + 1000;
    await row.save();
    await sendTask(ctx, row);
    await ctx.answerCbQuery();
  } catch (err) {
    console.error("❌ ERROR in verify_telegram:", err);
  }
});

bot.on("text", async (ctx) => {
  // Ignore the /test command so this handler doesn't process it
  if (ctx.message.text.startsWith('/')) return;

  try {
    const telegramId = ctx.from.id;
    const text = ctx.message.text;

    await doc.useServiceAccountAuth(googleCreds);
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle["ChainFabric Bot Users"];
    const row = await getUserRow(sheet, telegramId);

    if (!row) return ctx.reply("❌ You need to /start first.");

    if (row.TaskStatus === "telegram_done") {
      row.InstagramUsername = text;
      row.TaskStatus = "instagram_done";
      row.Balance = parseInt(row.Balance || 0) + 500;
      await row.save();
      await sendTask(ctx, row);
    }
  } catch (err) {
    console.error("❌ ERROR in bot.on('text'):", err);
  }
});

bot.on("photo", async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    await doc.useServiceAccountAuth(googleCreds);
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle["ChainFabric Bot Users"];
    const row = await getUserRow(sheet, telegramId);

    if (!row) return ctx.reply("❌ You need to /start first.");

    if (row.TaskStatus === "instagram_done") {
      row.YouTubeVerified = "✅ Yes";
      row.TaskStatus = "youtube_done";
      row.Balance = parseInt(row.Balance || 0) + 500;
      await row.save();
      await sendTask(ctx, row);
    }
  } catch (err) {
    console.error("❌ ERROR in bot.on('photo'):", err);
    ctx.reply("Sorry, there was an error processing the photo. Please try again.");
  }
});

bot.action("refresh_profile", async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    await doc.useServiceAccountAuth(googleCreds);
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle["ChainFabric Bot Users"];
    const row = await getUserRow(sheet, telegramId);

    if (!row) return ctx.answerCbQuery("❌ You need to /start first.", { show_alert: true });

    const refLink = `https://t.me/${ctx.botInfo.username}?start=${row.ReferralCode}`;
    const balance = row.Balance || 0;
    const referrals = row.Referrals || 0;

    await ctx.editMessageText(
      `👤 <b>Your Profile</b>\n\n💰 Balance: <b>${balance} CNFC</b>\n👥 Referrals: <b>${referrals}</b>`,
      {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.url("🔗 Share Referral Link", refLink)],
            [Markup.button.callback("🔄 Refresh", "refresh_profile")],
            [Markup.button.callback("🆕 New Task", "new_task")]
          ])
      }
    );
    await ctx.answerCbQuery();
  } catch (err) {
    console.error("❌ ERROR in refresh_profile:", err);
    if (err.description && err.description.includes('message is not modified')) {
      await ctx.answerCbQuery("Data is already up to date.");
    }
  }
});

bot.action("new_task", async (ctx) => {
  await ctx.answerCbQuery("🛠 New task functionality coming soon...", { show_alert: true });
});

// --- 8. Launch Bot ---
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

bot.launch().then(() => {
  console.log('✅ Bot launched successfully!');
}).catch(err => {
  console.error('❌ FATAL: Failed to launch bot:', err);
});