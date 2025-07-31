require("dotenv").config();
const fs = require('fs');
const { Telegraf, Markup } = require("telegraf");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const express = require('express');

// --- 1. Credential Loading ---
let googleCreds;
try {
  const credsPath = process.env.GOOGLE_CREDS_PATH || './creds.json';
  const rawData = fs.readFileSync(credsPath, 'utf8');
  googleCreds = JSON.parse(rawData);
  console.log(`✅ Credentials loaded for project: ${googleCreds.project_id}`);
} catch (err) {
  console.error("❌ FATAL: Could not read credentials.", err.message);
  process.exit(1);
}

// --- 2. Express Server ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('CNFC Telegram Bot is running.'));
app.listen(port, () => console.log(`✅ Web server listening on port ${port}`));

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

// --- 6. Main Bot Logic ---

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
      
      // ✅ Using HTML parse_mode, which safely handles the underscore
      await ctx.reply(
        `👤 <b>Your Profile</b>\n\n💰 Balance: <b>${balance} CNFC</b>\n👥 Referrals: <b>${referrals}</b>\n🔗 Referral Link:\n${refLink}`,
        {
          parse_mode: "HTML",
          reply_markup: Markup.inlineKeyboard([
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
            const newReferralCode = generateReferralCode(rows.length);
            let referredBy = "";
            let referrerRow = null;
            if (refCode) {
                referrerRow = rows.find((r) => r.ReferralCode === refCode);
                if (referrerRow) referredBy = refCode;
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
    } catch(err) {
        console.error("❌ ERROR in bot.start:", err);
        ctx.reply("An error occurred. Please try again later.");
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
    } catch(err) {
        console.error("❌ ERROR in verify_telegram:", err);
    }
});

bot.on("text", async (ctx) => {
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

      // ✅ RE-ADDED the messages you wanted
      await ctx.reply("✅ YouTube subscription verified.\n\n+500 CNFC Points");
      await ctx.reply("🎉 Thanks for joining ChainFabric!\n\nYou can earn minumum 2000 CNFC points and No limit of maximum CNFC points you can earn. \n📬 Copy your referral link and share it to earn +1000 CNFC Points per signup (no limit)!. \n🗓️ You will receive the all points you earn on ChainFabric when we launch on 16th August 2025 to claim your rewards.");

      // This now sends the final profile message
      await sendTask(ctx, row);
    }
  } catch (err) {
    console.error("❌ ERROR in bot.on('photo'):", err);
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
            `👤 <b>Your Profile</b>\n\n💰 Balance: <b>${balance} CNFC</b>\n👥 Referrals: <b>${referrals}</b>\n🔗 Referral Link:\n${refLink}`,
            {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback("🔄 Refresh", "refresh_profile")],
                    [Markup.button.callback("🆕 New Task", "new_task")]
                ])
            }
        );
        await ctx.answerCbQuery();
    } catch (err) {
        if (!err.description?.includes('message is not modified')) {
            console.error("❌ ERROR in refresh_profile:", err);
        }
        await ctx.answerCbQuery();
    }
});

bot.action("new_task", (ctx) => ctx.answerCbQuery("🛠 New task functionality coming soon...", { show_alert: true }));

// --- 7. Launch Bot ---
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

bot.launch().then(() => {
  console.log('✅ Bot launched successfully!');
}).catch(err => {
  console.error('❌ FATAL: Failed to launch bot:', err);
});