require("dotenv").config();
const fs = require('fs');
const express = require('express');
const { Telegraf, Markup } = require("telegraf");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require('google-auth-library');

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

// --- 2. Initialize Auth & Bot ---
const serviceAccountAuth = new JWT({
  email: googleCreds.client_email,
  key: googleCreds.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const bot = new Telegraf(process.env.BOT_TOKEN);
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

// --- 3. Constants ---
const SHEET_TITLE = "ChainFabric Bot Users";
const CHANNEL_USERNAME = "chainfabric_official";
const CHANNEL_USERNAME2 = "chainfabricnews";
const INSTAGRAM_URL = "https://instagram.com/chainfabric";
const YOUTUBE_URL = "https://youtube.com/@chainfabric";
const ARTICLE_URL = "https://chainfabricnews.blogspot.com/";
const AD_URL = "https://otieu.com/4/9649985";
const WEBHOOK_URL = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`; // dynamic Render domain
const SECRET_PATH = "/telegraf/chainfabric_secret"; // stable path for webhook

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

async function getUserRow(sheet, telegramId) {
  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();
  return rows.find((row) => row.get('TelegramID') === String(telegramId));
}

// --- 5. Bot Logic (same as before) ---
const userAdCooldown = new Set();

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
  const refLink = `https://t.me/${ctx.botInfo.username}?start=${row.get('ReferralCode')}`;
  const balance = row.get('Balance') || 0;
  const referrals = row.get('Referrals') || 0;
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

// --- 6. Bot Event Handlers (unchanged from your code) ---
bot.start(async (ctx) => {
    try {
        const telegramId = ctx.from.id;
        const name = ctx.from.first_name || "";
        const username = ctx.from.username || "";
        const refCode = ctx.startPayload || "";

        await doc.loadInfo();
        const sheet = doc.sheetsByTitle[SHEET_TITLE];
        if (!sheet) throw new Error(`Sheet "${SHEET_TITLE}" not found.`);
        
        let userRow = await getUserRow(sheet, telegramId);
        if (!userRow) {
            const rows = await sheet.getRows();
            const newReferralCode = generateReferralCode(rows.length);
            let referredBy = "";
            let referrerRow = null;

            if (refCode) {
                referrerRow = rows.find(r => r.get('ReferralCode') === refCode);
                if (referrerRow) referredBy = refCode;
            }

            userRow = await sheet.addRow({
                TelegramID: telegramId,
                Name: name,
                Username: username,
                JoinedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
                ReferralCode: newReferralCode,
                ReferredBy: referredBy,
                Referrals: 0,
                Balance: 0,
                TaskStatus: "start"
            });

            if (referrerRow) {
                referrerRow.set('Referrals', parseInt(referrerRow.get('Referrals') || 0) + 1);
                referrerRow.set('Balance', parseInt(referrerRow.get('Balance') || 0) + 1000);
                await referrerRow.save();
            }
        }

        await sendTask(ctx, userRow);
    } catch (err) {
        console.error("❌ ERROR in bot.start:", err);
        ctx.reply("An error occurred. Please try again later.");
    }
});

bot.command('balance', async (ctx) => {
    try {
        const telegramId = ctx.from.id;
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle[SHEET_TITLE];
        const userRow = await getUserRow(sheet, telegramId);
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
        const telegramId = ctx.from.id;
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle[SHEET_TITLE];
        let row = await getUserRow(sheet, telegramId);

        if (!row) {
            const name = ctx.from.first_name || "";
            const username = ctx.from.username || "";
            const rows = await sheet.getRows();
            const newReferralCode = generateReferralCode(rows.length);
            row = await sheet.addRow({
                TelegramID: telegramId,
                Name: name,
                Username: username,
                JoinedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
                ReferralCode: newReferralCode,
                ReferredBy: '',
                Referrals: 0,
                Balance: 0,
                TaskStatus: "start"
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
    } catch (err) {
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
        const row = await getUserRow(sheet, telegramId);
        if (!row) return ctx.reply("❌ You need to /start first.");

        if (row.get('ArticleSessionID') && row.get('ArticleSessionID') === text) {
            row.set('Balance', parseInt(row.get('Balance') || 0) + 100);
            row.set('ArticleSessionID', '');
            await row.save();
            await ctx.reply("✅ Success! You've earned +100 CNFC Points. Click /balance or Refresh to see your updated balance.");
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
        const row = await getUserRow(sheet, telegramId);
        if (!row) return ctx.reply("❌ You need to /start first.");

        if (row.get('TaskStatus') === "instagram_done") {
            row.set('YouTubeVerified', "✅ Yes");
            row.set('TaskStatus', "youtube_done");
            row.set('Balance', parseInt(row.get('Balance') || 0) + 500);
            await row.save();
            await ctx.reply("✅ YouTube subscription verified.\n\n+500 CNFC Points");
            await ctx.reply("🎉 Thanks for joining ChainFabric!\n\nYou can earn minimum 2000 CNFC points and there's no limit to how much you can earn. Share your referral link to earn +1000 CNFC per signup. All rewards will be claimable on 16th August 2025.");
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
        const row = await getUserRow(sheet, telegramId);
        if (!row) return ctx.answerCbQuery("❌ You need to /start first.", { show_alert: true });

        const refLink = `https://t.me/${ctx.botInfo.username}?start=${row.get('ReferralCode')}`;
        const balance = row.get('Balance') || 0;
        const referrals = row.get('Referrals') || 0;
        const profileText = `👤 <b>Your Profile</b>\n\n💰 Balance: <b>${balance} CNFC</b>\n👥 Referrals: <b>${referrals}</b>\n🔗 Referral Link:\n${refLink}`;

        await ctx.editMessageText(profileText, {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🔄 Refresh", callback_data: "refresh_profile" }],
                    [{ text: "Watch Ad (+30 Points)", callback_data: "watch_ad" }],
                    [{ text: "Read Article (+100 Points)", callback_data: "read_article" }]
                ]
            }
        });
        await ctx.answerCbQuery();
    } catch (err) {
        if (!err.description?.includes('message is not modified')) {
            console.error("❌ ERROR in refresh_profile:", err);
        }
        await ctx.answerCbQuery("Data is already up to date.");
    }
});

bot.action("watch_ad", async (ctx) => {
    const telegramId = ctx.from.id;
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
    const telegramId = ctx.from.id;
    if (userAdCooldown.has(telegramId)) {
        return ctx.answerCbQuery("You’ve recently claimed this reward. Please wait.", { show_alert: true });
    }

    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle[SHEET_TITLE];
        const row = await getUserRow(sheet, telegramId);
        if (row) {
            row.set('Balance', parseInt(row.get('Balance') || 0) + 30);
            await row.save();
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
        const telegramId = ctx.from.id;
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle[SHEET_TITLE];
        const row = await getUserRow(sheet, telegramId);
        if (row) {
            const sessionCode = generateSessionCode();
            row.set('ArticleSessionID', sessionCode);
            await row.save();
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



// --- 7. Webhook Setup (Fixed) ---
const app = express();

// Optional: Log all incoming requests to help debug
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
