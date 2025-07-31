require("dotenv").config();
const fs = require('fs');
const { Telegraf, Markup } = require("telegraf");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require('google-auth-library');
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

// --- 2. Initialize Authentication ---
const serviceAccountAuth = new JWT({
    email: googleCreds.client_email,
    key: googleCreds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// --- 3. Express Server ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('CNFC Telegram Bot is running.'));
app.listen(port, () => console.log(`✅ Web server listening on port ${port}`));

// --- 4. Bot and Google Sheet Initialization ---
const bot = new Telegraf(process.env.BOT_TOKEN);
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

// --- 5. Constants ---
const SHEET_TITLE = "ChainFabric Bot Users";
const CHANNEL_USERNAME = "chainfabric_official";
const CHANNEL_USERNAME2 = "chainfabricnews";
const INSTAGRAM_URL = "https://instagram.com/chainfabric";
const YOUTUBE_URL = "https://youtube.com/@chainfabric";
const ARTICLE_URL = "https://chainfabricnews.blogspot.com/";
const AD_URL = "https://otieu.com/4/9649985";

// --- 6. Helper Functions ---
const generateReferralCode = (count) => "USER" + String(count + 1).padStart(3, "0");

function generateSessionCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const nums = '0123456789';
  let charPart = '';
  let numPart = '';
  for (let i = 0; i < 4; i++) {
    charPart += chars.charAt(Math.floor(Math.random() * chars.length));
    numPart += nums.charAt(Math.floor(Math.random() * nums.length));
  }
  return `${charPart}${numPart}`;
}

async function getUserRow(sheet, telegramId) {
  const rows = await sheet.getRows();
  return rows.find((row) => row.get('TelegramID') === String(telegramId));
}

// --- 7. Main Bot Logic ---
async function sendTask(ctx, row) {
  const task = row.get('TaskStatus') || "start";
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
      const refLink = `https://t.me/${ctx.botInfo.username}?start=${row.get('ReferralCode')}`;
      const balance = row.get('Balance') || 0;
      const referrals = row.get('Referrals') || 0;
      
      await ctx.reply(
        `👤 <b>Your Profile</b>\n\n💰 Balance: <b>${balance} CNFC</b>\n👥 Referrals: <b>${referrals}</b>\n🔗 Referral Link:\n${refLink}`,
        {
          parse_mode: "HTML",
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("🔄 Refresh", "refresh_profile")],
            [Markup.button.callback("Watch Ad (+30 Points)", "watch_ad")],
            [Markup.button.callback("Read Article (+100 Points)", "read_article")]
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

        await doc.loadInfo();
        const sheet = doc.sheetsByTitle[SHEET_TITLE];
        if (!sheet) throw new Error(`Sheet with title "${SHEET_TITLE}" was not found.`);
        
        let userRow = await getUserRow(sheet, telegramId);
        if (!userRow) {
            const rows = await sheet.getRows();
            const newReferralCode = generateReferralCode(rows.length);
            let referredBy = "";
            let referrerRow = null;
            if (refCode) {
                referrerRow = rows.find((r) => r.get('ReferralCode') === refCode);
                if (referrerRow) referredBy = refCode;
            }
            userRow = await sheet.addRow({
                TelegramID: telegramId, Name: name, Username: username,
                JoinedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
                ReferralCode: newReferralCode, ReferredBy: referredBy,
                Referrals: 0, Balance: 0, TaskStatus: "start"
            });
            if (referrerRow) {
                referrerRow.set('Referrals', parseInt(referrerRow.get('Referrals') || 0) + 1);
                referrerRow.set('Balance', parseInt(referrerRow.get('Balance') || 0) + 1000);
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
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle[SHEET_TITLE];
        if (!sheet) throw new Error(`Sheet '${SHEET_TITLE}' not found.`);

        let row = await getUserRow(sheet, telegramId);

        if (!row) {
            console.log(`User ${telegramId} clicked 'verify_telegram' but was not found. Creating new entry.`);
            const name = ctx.from.first_name || "";
            const username = ctx.from.username || "";
            const rows = await sheet.getRows();
            const newReferralCode = generateReferralCode(rows.length);

            row = await sheet.addRow({
                TelegramID: telegramId, Name: name, Username: username,
                JoinedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
                ReferralCode: newReferralCode, ReferredBy: '',
                Referrals: 0, Balance: 0, TaskStatus: "start"
            });
        }

        if (row.get('TaskStatus') !== "start") {
            return ctx.answerCbQuery("You have already completed this step.");
        }

        row.set('TaskStatus', "telegram_done");
        row.set('Balance', parseInt(row.get('Balance') || 0) + 1000);
        await row.save();
        await sendTask(ctx, row);
        await ctx.answerCbQuery();
    } catch(err) {
        console.error("❌ ERROR in verify_telegram:", err);
        await ctx.answerCbQuery("An error occurred. Please try again.", { show_alert: true });
    }
});

bot.on("text", async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    try {
        const telegramId = ctx.from.id;
        const text = ctx.message.text.trim();
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle[SHEET_TITLE];
        if (!sheet) throw new Error(`Sheet '${SHEET_TITLE}' not found.`);
        const row = await getUserRow(sheet, telegramId);
        if (!row) return ctx.reply("❌ You need to /start first.");
        
        if (row.get('ArticleSessionID') && row.get('ArticleSessionID') === text) {
            row.set('Balance', parseInt(row.get('Balance') || 0) + 100);
            row.set('ArticleSessionID', '');
            await row.save();
            await ctx.reply("✅ Success! You've earned +100 CNFC Points. Click Refresh to see your updated balance.");
        } else if (row.get('TaskStatus') === "telegram_done") {
            row.set('InstagramUsername', text);
            row.set('TaskStatus', "instagram_done");
            row.set('Balance', parseInt(row.get('Balance') || 0) + 500);
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
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle[SHEET_TITLE];
    if (!sheet) throw new Error(`Sheet '${SHEET_TITLE}' not found.`);
    const row = await getUserRow(sheet, telegramId);
    if (!row) return ctx.reply("❌ You need to /start first.");

    if (row.get('TaskStatus') === "instagram_done") {
      row.set('YouTubeVerified', "✅ Yes");
      row.set('TaskStatus', "youtube_done");
      row.set('Balance', parseInt(row.get('Balance') || 0) + 500);
      await row.save();
      await ctx.reply("✅ YouTube subscription verified.\n\n+500 CNFC Points");
      await ctx.reply("🎉 Thanks for joining ChainFabric!\n\nYou can earn minumum 2000 CNFC points and No limit of maximum CNFC points you can earn. \n📬 Copy your referral link and share it to earn +1000 CNFC Points per signup (no limit)!. \n🗓️ You will receive the all points you earn on ChainFabric when we launch on 16th August 2025 to claim your rewards.");
      await sendTask(ctx, row);
    }
  } catch (err) {
    console.error("❌ ERROR in bot.on('photo'):", err);
  }
});

bot.action("refresh_profile", async (ctx) => {
    try {
        const telegramId = ctx.from.id;
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle[SHEET_TITLE];
        if (!sheet) throw new Error(`Sheet '${SHEET_TITLE}' not found.`);
        const row = await getUserRow(sheet, telegramId);
        if (!row) return ctx.answerCbQuery("❌ You need to /start first.", { show_alert: true });

        const refLink = `https://t.me/${ctx.botInfo.username}?start=${row.get('ReferralCode')}`;
        const balance = row.get('Balance') || 0;
        const referrals = row.get('Referrals') || 0;

        await ctx.editMessageText(
            `👤 <b>Your Profile</b>\n\n💰 Balance: <b>${balance} CNFC</b>\n👥 Referrals: <b>${referrals}</b>\n🔗 Referral Link:\n${refLink}`,
            {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback("🔄 Refresh", "refresh_profile")],
                    [Markup.button.callback("Watch Ad (+30 Points)", "watch_ad")],
                    [Markup.button.callback("Read Article (+100 Points)", "read_article")]
                ])
            }
        );
        await ctx.answerCbQuery();
    } catch (err) {
        if (!err.description?.includes('message is not modified')) {
            console.error("❌ ERROR in refresh_profile:", err);
        }
        await ctx.answerCbQuery("Data is already up to date.");
    }
});

const userAdCooldown = new Set();
bot.action("watch_ad", async (ctx) => {
    if (userAdCooldown.has(ctx.from.id)) {
        return ctx.answerCbQuery("Please wait at least 1 minute before watching another ad.", { show_alert: true });
    }
    await ctx.answerCbQuery();
    await ctx.reply(
        "⚠️ <b>Disclaimer & Warning</b> ⚠️\nWe are not responsible for the content of the ads shown. Do not click on, download, or install anything from the ads. Proceed at your own risk.",
        { parse_mode: "HTML" }
    );
    await ctx.reply(
        "Please watch the ad for at least 1 minute to receive your reward.",
        Markup.inlineKeyboard([
            [Markup.button.url("📺 Watch Ad", AD_URL)],
            [Markup.button.callback("✅ I Watched the Ad", "claim_ad_reward")]
        ])
    );
});

bot.action('claim_ad_reward', async (ctx) => {
    const telegramId = ctx.from.id;
    if (userAdCooldown.has(telegramId)) {
        return ctx.answerCbQuery("You have already claimed this reward recently. Please wait.", { show_alert: true });
    }
    
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle[SHEET_TITLE];
        if (!sheet) throw new Error(`Sheet '${SHEET_TITLE}' not found.`);
        const row = await getUserRow(sheet, telegramId);

        if (row) {
            row.set('Balance', parseInt(row.get('Balance') || 0) + 30);
            await row.save();
            
            userAdCooldown.add(telegramId);
            setTimeout(() => {
                userAdCooldown.delete(telegramId);
            }, 60000);

            await ctx.editMessageText("✅ Thanks for watching! You've earned +30 CNFC Points. Click Refresh to see your updated balance.");
            await ctx.answerCbQuery("Reward claimed!");
        } else {
            await ctx.answerCbQuery("Could not find your user data. Please /start the bot again.", { show_alert: true });
        }
    } catch (err) {
        console.error("❌ ERROR claiming ad reward:", err);
        await ctx.answerCbQuery("An error occurred while claiming your reward.", { show_alert: true });
    }
});

bot.action("read_article", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("⏳ Processing... generating your unique session code.");
    try {
        const telegramId = ctx.from.id;
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle[SHEET_TITLE];
        if (!sheet) throw new Error(`Sheet '${SHEET_TITLE}' not found.`);
        const row = await getUserRow(sheet, telegramId);
        if (row) {
            const sessionCode = generateSessionCode();
            row.set('ArticleSessionID', sessionCode);
            await row.save();
            const articleLink = `${ARTICLE_URL}?session=${sessionCode}`;
            await ctx.replyWithHTML(
                `<b>Here are your steps:</b>\n\n` +
                `1. Click the button below to open an article with your unique session ID.\n` +
                `2. Read the article for at least <b>2 minutes</b>.\n` +
                `3. At the bottom of the article, copy the session ID.\n` +
                `4. Paste the ID back here in the chat to receive your reward.\n\n` +
                `Your Session ID is: <code>${sessionCode}</code>`,
                Markup.inlineKeyboard([
                    [Markup.button.url("📰 Read Article", articleLink)]
                ])
            );
        } else {
            await ctx.reply("Could not find your user data. Please /start the bot again.");
        }
    } catch (err) {
        console.error("❌ ERROR generating article link:", err);
        await ctx.reply("An error occurred. Please try again.");
    }
});

// --- 8. Launch Bot ---
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

bot.launch().then(() => {
  console.log('✅ Bot launched successfully!');
}).catch(err => {
  console.error('❌ FATAL: Failed to launch bot:', err);
});