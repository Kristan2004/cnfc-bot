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

// --- Constants ---
const SHEET_ID = process.env.SHEET_ID;
const SHEET_TITLE = process.env.SHEET_TITLE || 'Sheet1';
const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);
const doc = new GoogleSpreadsheet(SHEET_ID);

// Simple cooldown sets
const userAdCooldown = new Set();
const userArticleCooldown = new Set();

// --- Utility Functions ---
function generateReferralCode(index) {
  return `USER${String(index + 1).padStart(3, '0')}`;
}

async function getUserRow(sheet, telegramId) {
  const rows = await sheet.getRows();
  return rows.find(r => String(r.TelegramID || r.get('TelegramID') || '').trim() === String(telegramId));
}

function buildProfileKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔄 Refresh", "refresh_profile")],
    [Markup.button.callback("Watch Ad (+30 Points)", "watch_ad")],
    [Markup.button.callback("Read Article (+100 Points)", "read_article")]
  ]);
}

async function sendProfile(ctx, row) {
  const balance = row.get('Balance') || 0;
  const referrals = row.get('Referrals') || 0;
  const referralCode = row.get('ReferralCode') || '';
  const botUsername = ctx.botInfo?.username || process.env.BOT_USERNAME || 'Chainfabric_bot';
  const refLink = `https://t.me/${botUsername}?start=${referralCode}`;

  const profileText = `👤 <b>Your Profile</b>\n\n💰 Balance: <b>${balance} CNFC</b>\n👥 Referrals: <b>${referrals}</b>\n🔗 Referral Link:\n${refLink}`;

  const keyboard = buildProfileKeyboard();
  console.log("DEBUG: Sending profile with keyboard:", JSON.stringify(keyboard));

  await ctx.replyWithHTML(profileText, keyboard);
}

async function editProfileMessage(ctx, row) {
  const balance = row.get('Balance') || 0;
  const referrals = row.get('Referrals') || 0;
  const referralCode = row.get('ReferralCode') || '';
  const botUsername = ctx.botInfo?.username || process.env.BOT_USERNAME || 'Chainfabric_bot';
  const refLink = `https://t.me/${botUsername}?start=${referralCode}`;

  const profileText = `👤 <b>Your Profile</b>\n\n💰 Balance: <b>${balance} CNFC</b>\n👥 Referrals: <b>${referrals}</b>\n🔗 Referral Link:\n${refLink}`;

  const keyboard = buildProfileKeyboard();
  console.log("DEBUG: Editing profile with keyboard:", JSON.stringify(keyboard));

  await ctx.editMessageText(profileText, {
    parse_mode: "HTML",
    ...keyboard
  });
}

// --- 4. Bot Handlers ---

// Start command / entry point with referral parsing
bot.start(async (ctx) => {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || "";
  const refCode = ctx.startPayload || "";

  try {
    await doc.useServiceAccountAuth({
      client_email: googleCreds.client_email,
      private_key: googleCreds.private_key
    });
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle[SHEET_TITLE];
    if (!sheet) throw new Error(`Sheet with title "${SHEET_TITLE}" not found.`);

    let userRow = await getUserRow(sheet, telegramId);
    const allRows = await sheet.getRows();

    if (!userRow) {
      const newReferralCode = generateReferralCode(allRows.length);
      let referredBy = "";
      let referrerRow = null;

      if (refCode) {
        referrerRow = allRows.find(r => String(r.ReferralCode || r.get('ReferralCode') || '') === refCode);
        if (referrerRow) {
          referredBy = referrerRow.TelegramID || referrerRow.get('TelegramID') || '';
          // give referral bonus logic here as needed...
        }
      }

      await sheet.addRow({
        TelegramID: telegramId,
        Name: ctx.from.first_name || '',
        Username: username,
        ReferralCode: newReferralCode,
        ReferredBy: referredBy,
        Balance: 2000, // initial balance if any
        Referrals: 0
      });

      userRow = await getUserRow(sheet, telegramId);

      // If there was a referrer, increment their referrals count
      if (referrerRow) {
        const currentReferrals = parseInt(referrerRow.get('Referrals') || 0);
        referrerRow.set('Referrals', currentReferrals + 1);
        await referrerRow.save();
      }
    }

    await sendProfile(ctx, userRow);
  } catch (err) {
    console.error("❌ ERROR in /start:", err);
    await ctx.reply("Something went wrong during registration. Please try again later.");
  }
});

// Callback: Refresh Profile
bot.action('refresh_profile', async (ctx) => {
  const telegramId = ctx.from.id;
  try {
    await doc.useServiceAccountAuth({
      client_email: googleCreds.client_email,
      private_key: googleCreds.private_key
    });
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle[SHEET_TITLE];
    if (!sheet) throw new Error(`Sheet '${SHEET_TITLE}' not found.`);
    const row = await getUserRow(sheet, telegramId);

    if (row) {
      await editProfileMessage(ctx, row);
    } else {
      await ctx.reply("Profile not found. Please /start again.");
    }
    await ctx.answerCbQuery(); // acknowledge
  } catch (err) {
    console.error("❌ ERROR on refresh_profile:", err);
    await ctx.answerCbQuery("Failed to refresh. Try again."); 
  }
});

// Callback: Watch Ad
bot.action('watch_ad', async (ctx) => {
  const telegramId = ctx.from.id;
  try {
    await doc.useServiceAccountAuth({
      client_email: googleCreds.client_email,
      private_key: googleCreds.private_key
    });
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle[SHEET_TITLE];
    if (!sheet) throw new Error(`Sheet '${SHEET_TITLE}' not found.`);
    const row = await getUserRow(sheet, telegramId);
    if (!row) {
      await ctx.reply("Profile missing. Please /start.");
      return;
    }

    if (userAdCooldown.has(telegramId)) {
      await ctx.answerCbQuery("You have already claimed this reward recently. Please wait.", { show_alert: true });
      return;
    }

    row.set('Balance', parseInt(row.get('Balance') || 0) + 30);
    await row.save();

    userAdCooldown.add(telegramId);
    setTimeout(() => userAdCooldown.delete(telegramId), 60 * 1000); // 1 minute cooldown

    await editProfileMessage(ctx, row);
    await ctx.answerCbQuery("Ad watched! +30 CNFC");
  } catch (err) {
    console.error("❌ ERROR in watch_ad:", err);
    await ctx.answerCbQuery("Error processing ad reward.");
  }
});

// Callback: Read Article
bot.action('read_article', async (ctx) => {
  const telegramId = ctx.from.id;
  try {
    await doc.useServiceAccountAuth({
      client_email: googleCreds.client_email,
      private_key: googleCreds.private_key
    });
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle[SHEET_TITLE];
    if (!sheet) throw new Error(`Sheet '${SHEET_TITLE}' not found.`);
    const row = await getUserRow(sheet, telegramId);
    if (!row) {
      await ctx.reply("Profile missing. Please /start.");
      return;
    }

    if (userArticleCooldown.has(telegramId)) {
      await ctx.answerCbQuery("You have already claimed this recently. Please wait.", { show_alert: true });
      return;
    }

    row.set('Balance', parseInt(row.get('Balance') || 0) + 100);
    await row.save();

    userArticleCooldown.add(telegramId);
    setTimeout(() => userArticleCooldown.delete(telegramId), 5 * 60 * 1000); // 5 minutes cooldown

    await editProfileMessage(ctx, row);
    await ctx.answerCbQuery("Article read! +100 CNFC");
  } catch (err) {
    console.error("❌ ERROR in read_article:", err);
    await ctx.answerCbQuery("Error processing article reward.");
  }
});

// ... (keep all your other existing handlers like youtube_done, referral verification, session code, etc. unchanged)

// --- 8. Launch Bot & Server ---
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

bot.launch().then(() => {
  console.log('✅ Bot launched successfully!');
}).catch(err => {
  console.error('❌ FATAL: Failed to launch bot:', err);
});

// Optional Express if you had it:
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('CNFC Bot is running.'));
app.listen(port, () => console.log(`HTTP server listening on ${port}`));
