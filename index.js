require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const creds = require("./creds.json");

const bot = new Telegraf(process.env.BOT_TOKEN);
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);

const CHANNEL_USERNAME = "chainfabric_official";
const CHANNEL_USERNAME2 = "chainfabricnews";
const INSTAGRAM_URL = "https://instagram.com/chainfabric.official";
const YOUTUBE_URL = "https://youtube.com/@chainfabric";

const generateReferralCode = (count) => "USER" + String(count + 1).padStart(3, "0");

async function getUserRow(sheet, telegramId) {
  const rows = await sheet.getRows();
  return rows.find((row) => row.TelegramID === String(telegramId));
}

async function sendTask(ctx, row) {
  const task = row.TaskStatus || "start";

  if (task === "start") {
    await ctx.reply("📲 Please join our Telegram channels:", Markup.inlineKeyboard([
      Markup.button.url("Join Channel 1", `https://t.me/${CHANNEL_USERNAME}`),
      Markup.button.url("Join Channel 2", `https://t.me/${CHANNEL_USERNAME2}`),
      Markup.button.callback("✅ I’ve Joined", "verify_telegram")
    ]));
  } else if (task === "telegram_done") {
    await ctx.reply("🎉 Telegram Join Verified!\n\n+1000 CNFC Points");
    await ctx.reply("📸 Follow our Instagram and enter your username:", Markup.inlineKeyboard([
      Markup.button.url("Follow Instagram", INSTAGRAM_URL)
    ]));
    await ctx.reply("✍️ Now enter your Instagram username:");
  } else if (task === "instagram_done") {
    await ctx.reply("✅ Instagram Username Saved!\n\n+500 CNFC Points");
    await ctx.reply("▶️ Subscribe our YouTube and send screenshot proof:", Markup.inlineKeyboard([
      Markup.button.url("Subscribe YouTube", YOUTUBE_URL)
    ]));
  } else if (task === "youtube_done") {
    await ctx.reply("✅ YouTube subscription verified.\n\n+500 CNFC Points");
    const refLink = `https://t.me/chainfabricbot?start=${row.ReferralCode}`;
    const balance = row.Balance || 0;
    const referrals = row.Referrals || 0;

    await ctx.reply(
      `🎉 All tasks completed!\n\n👤 *Your Profile*\n\n💰 Balance: *${balance} CNFC*\n👥 Referrals: *${referrals}*\n🔗 Referral Link:\n${refLink}`,
      {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("🔄 Refresh", "refresh_profile")],
          [Markup.button.callback("🆕 New Task", "new_task")]
        ])
      }
    );
  }
}

bot.start(async (ctx) => {
  const telegramId = ctx.from.id;
  const name = ctx.from.first_name || "";
  const username = ctx.from.username || "";
  const refCode = ctx.startPayload || "";

  await doc.useServiceAccountAuth(creds);
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
      if (referrerRow) {
        referredBy = refCode;
      }
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
      referrerRow.Referrals = parseInt(referrerRow.Referrals || 0) + 1;
      referrerRow.Balance = parseInt(referrerRow.Balance || 0) + 1000;
      await referrerRow.save();
    }
  }

  await sendTask(ctx, userRow);
});

bot.action("verify_telegram", async (ctx) => {
  const telegramId = ctx.from.id;
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle["ChainFabric Bot Users"];
  const row = await getUserRow(sheet, telegramId);

  if (!row) return ctx.reply("❌ You need to /start first.");
  if (row.TaskStatus !== "start") return;

  row.TaskStatus = "telegram_done";
  row.Balance = parseInt(row.Balance || 0) + 1000;
  await row.save();

  await sendTask(ctx, row);
});

bot.on("text", async (ctx) => {
  const telegramId = ctx.from.id;
  const text = ctx.message.text;

  await doc.useServiceAccountAuth(creds);
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
});

// ✅ Handle YouTube screenshot verification
bot.on("photo", async (ctx) => {
  const telegramId = ctx.from.id;
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle["ChainFabric Bot Users"];
  const row = await getUserRow(sheet, telegramId);

  if (!row) return ctx.reply("❌ You need to /start first.");

  if (row.TaskStatus === "instagram_done") {
    row.YouTubeVerified = "✅ Yes";
    row.TaskStatus = "youtube_done";
    row.Balance = parseInt(row.Balance || 0) + 500;
    await row.save();

    await ctx.reply("✅ YouTube subscription verified.\n\n+500 CNFC Points");

    const refLink = `https://t.me/chainfabricbot?start=${row.ReferralCode}`;
    const balance = row.Balance || 0;
    const referrals = row.Referrals || 0;

    await ctx.telegram.sendMessage(
      ctx.chat.id,
      `🎉 All tasks completed!\n\n👤 *Your Profile*\n\n💰 Balance: *${balance} CNFC*\n👥 Referrals: *${referrals}*\n🔗 Referral Link:\n${refLink}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback("🔄 Refresh", "refresh_profile")],
            [Markup.button.callback("🆕 New Task", "new_task")]
          ]
        }
      }
    );
  }
});

// ✅ Refresh Profile Button
bot.action("refresh_profile", async (ctx) => {
  const telegramId = ctx.from.id;
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle["ChainFabric Bot Users"];
  const row = await getUserRow(sheet, telegramId);

  if (!row) return ctx.reply("❌ You need to /start first.");

  const refLink = `https://t.me/chainfabricbot?start=${row.ReferralCode}`;
  const balance = row.Balance || 0;
  const referrals = row.Referrals || 0;

  await ctx.editMessageText(
    `👤 *Your Profile*\n\n💰 Balance: *${balance} CNFC*\n👥 Referrals: *${referrals}*\n🔗 Referral Link:\n${refLink}`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback("🔄 Refresh", "refresh_profile")],
          [Markup.button.callback("🆕 New Task", "new_task")]
        ]
      }
    }
  );
});

// ✅ New Task Placeholder
bot.action("new_task", async (ctx) => {
  await ctx.reply("🛠 New task functionality coming soon...");
});

// ✅ Start Bot
bot.launch();

