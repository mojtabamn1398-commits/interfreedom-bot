import TelegramBot from "node-telegram-bot-api";
import { logger } from "../lib/logger";
import { getState, setState, clearState } from "./state";
import {
  userMenuKeyboard,
  adminPanelKeyboard,
  botSettingsKeyboard,
  adminManageKeyboard,
  cancelKeyboard,
} from "./keyboards";
import { pe, safeSend, broadcastMessage, formatDate } from "./utils";
import {
  getOrCreateUser,
  getReferrerInfo,
  getUserByTelegramId,
  getUserByUsername,
  getInviteCount,
  addCoins,
  removeCoins,
  setCoins,
  addCoinsToAll,
  blockUser,
  unblockUser,
  getBlockedUsers,
  getAllUsers,
  getRecentUsers,
  getTopInviters,
  getStats,
  getUserServices,
  deleteUserServices,
  getServiceFromPool,
  assignServiceToUser,
  addServiceToPool,
  getPoolStats,
  isAdmin,
  isSuperAdmin,
  ensureSuperAdmin,
  addAdmin,
  removeAdmin,
  getAdmins,
  getSetting,
  setSetting,
  getDefaultSettings,
} from "./dbHelper";

async function isMemberOfChannel(
  bot: TelegramBot,
  channel: string,
  userId: number
): Promise<boolean> {
  try {
    const member = await bot.getChatMember(channel, userId);
    return ["member", "administrator", "creator"].includes(member.status);
  } catch {
    return true;
  }
}

async function checkMandatoryChannel(
  bot: TelegramBot,
  chatId: number,
  userId: number
): Promise<boolean> {
  const channel = await getSetting("mandatory_channel");
  if (!channel) return true;
  const isMember = await isMemberOfChannel(bot, channel, userId);
  if (!isMember) {
    await safeSend(
      chatId,
      `⚠️ برای استفاده از ربات باید ابتدا در کانال ما عضو بشی:\n${channel}`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "📢 عضویت در کانال",
                url: `https://t.me/${channel.replace("@", "")}`,
              },
            ],
            [{ text: "✅ عضو شدم، بررسی کن", callback_data: "check_joined" }],
          ],
        },
      }
    );
    return false;
  }
  return true;
}

export function setupBot(bot: TelegramBot) {
  bot.on("message", async (msg) => {
    if (!msg.text || !msg.from) return;
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    const firstName = msg.from.first_name ?? "کاربر";
    const text = msg.text.trim();

    logger.info({ chatId, userId, text }, "MSG_RECEIVED");
    try {
      await ensureSuperAdmin(userId, username);
      const state = getState(userId);

      if (text === "❌ انصراف") {
        clearState(userId);
        const adminUser = await isAdmin(userId, username);
        if (adminUser) {
          const maintenance = (await getSetting("maintenance_mode")) === "true";
          await safeSend(chatId, "❌ عملیات لغو شد.", {
            reply_markup: adminPanelKeyboard(maintenance),
          });
        } else {
          await safeSend(chatId, "❌ عملیات لغو شد.", {
            reply_markup: userMenuKeyboard,
          });
        }
        return;
      }

      if (state.action !== "idle") {
        await handleStateInput(bot, msg, state, userId, chatId, username, firstName);
        return;
      }

      if (text.startsWith("/start")) {
        await handleStart(bot, msg, userId, chatId, username, firstName, text);
        return;
      }

      if (text === "/admin") {
        await handleAdminCommand(bot, chatId, userId, username);
        return;
      }

      const adminUser = await isAdmin(userId, username);
      if (adminUser) {
        const handled = await handleAdminMessage(bot, text, chatId, userId, username);
        if (handled) return;
      }

      await handleUserMessage(bot, text, chatId, userId, username, firstName);
    } catch (err) {
      logger.error({ err, chatId }, "Error handling message");
      await safeSend(chatId, "❌ خطایی رخ داد. لطفاً دوباره امتحان کن.");
    }
  });

  bot.on("callback_query", async (query) => {
    if (!query.data || !query.from || !query.message) return;
    const chatId = query.message.chat.id;
    const userId = query.from.id;

    try {
      if (query.data === "check_joined") {
        const channel = await getSetting("mandatory_channel");
        if (!channel) {
          await bot.answerCallbackQuery(query.id, { text: "✅ اوکیه!" });
          return;
        }
        const isMember = await isMemberOfChannel(bot, channel, userId);
        if (isMember) {
          await bot.answerCallbackQuery(query.id, { text: "✅ عضویت تایید شد!" });
          await safeSend(chatId, "✅ عضویت تایید شد! حالا می‌تونی از ربات استفاده کنی.", {
            reply_markup: userMenuKeyboard,
          });
        } else {
          await bot.answerCallbackQuery(query.id, {
            text: "❌ هنوز عضو نشدی!",
            show_alert: true,
          });
        }
      }
    } catch (err) {
      logger.error({ err }, "Error handling callback query");
    }
  });

  bot.on("polling_error", (err) => {
    logger.error({ err }, "Telegram polling error");
  });
}

async function handleStart(
  bot: TelegramBot,
  msg: TelegramBot.Message,
  userId: number,
  chatId: number,
  username: string | undefined,
  firstName: string,
  text: string
) {
  const parts = text.split(" ");
  let referredBy: number | undefined;
  if (parts[1]) {
    const ref = parseInt(parts[1], 10);
    if (!isNaN(ref) && ref !== userId) referredBy = ref;
  }

  const maintenance = (await getSetting("maintenance_mode")) === "true";
  const adminUser = await isAdmin(userId, username);

  if (maintenance && !adminUser) {
    await safeSend(chatId, "🔧 ربات در حال تعمیر است. لطفاً بعداً مراجعه کنید.");
    return;
  }

  const { isNew } = await getOrCreateUser(userId, username, firstName, referredBy);

  if (isNew && referredBy) {
    const refInfo = await getReferrerInfo(referredBy);
    if (refInfo) {
      const rewardAmt = (await getSetting("invite_reward")) ?? "1";
      const updatedRef = await getUserByTelegramId(referredBy);
      await safeSend(
        referredBy,
        `🎉 یک زیرمجموعه جدید برات ثبت شد.\n` +
          `🪙 ${rewardAmt} سکه گرفتی.\n` +
          `👥 تعداد زیرمجموعه موفق: ${refInfo.invites + 1}\n` +
          `💰 سکه فعلی: ${(updatedRef?.coins ?? 0)}`
      );
    }
  }

  const channel = await getSetting("mandatory_channel");
  if (channel) {
    const isMember = await isMemberOfChannel(bot, channel, userId);
    if (!isMember) {
      const welcome = (await getSetting("welcome_message")) ?? "سلام! به ربات خوش آمدی 👋";
      await safeSend(
        chatId,
        `${pe("star")} ${welcome}\n\n👤 خوش آمدی ${firstName}!\n\n⚠️ برای استفاده از ربات باید ابتدا عضو کانال بشی:`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "📢 عضویت در کانال", url: `https://t.me/${channel.replace("@", "")}` }],
              [{ text: "✅ عضو شدم، بررسی کن", callback_data: "check_joined" }],
            ],
          },
        }
      );
      return;
    }
  }

  const welcome = (await getSetting("welcome_message")) ?? "سلام! به ربات خوش آمدی 👋";
  const channelUsername = await getSetting("channel_username");

  let welcomeText = `${pe("star")} ${welcome}\n\n👤 خوش آمدی ${firstName}!`;
  if (channelUsername) welcomeText += `\n\n📢 کانال ما: ${channelUsername}`;

  await safeSend(chatId, welcomeText, { reply_markup: userMenuKeyboard });
}

async function handleAdminCommand(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  username: string | undefined
) {
  const adminUser = await isAdmin(userId, username);
  if (!adminUser) {
    await safeSend(chatId, "❌ شما دسترسی ادمین ندارید.");
    return;
  }
  await showAdminPanel(bot, chatId);
}

async function showAdminPanel(bot: TelegramBot, chatId: number) {
  const stats = await getStats();
  const maintenance = (await getSetting("maintenance_mode")) === "true";
  const text =
    `🛡️ <b>پنل مدیریت</b>\n\n` +
    `${pe("crown")} کاربران: ${stats.users.toLocaleString("fa-IR")}\n` +
    `📦 سرویس‌ها: ${stats.services.toLocaleString("fa-IR")}\n` +
    `${pe("star")} جمع سکه‌ها: ${stats.coins.toLocaleString("fa-IR")}\n\n` +
    `👇 از دکمه‌های پایین یکی رو انتخاب کن`;
  await safeSend(chatId, text, { reply_markup: adminPanelKeyboard(maintenance) });
}

async function handleAdminMessage(
  bot: TelegramBot,
  text: string,
  chatId: number,
  userId: number,
  username: string | undefined
): Promise<boolean> {
  switch (text) {
    case "🔍 اطلاعات کاربر":
      setState(userId, "await_user_info_id");
      await safeSend(chatId, "🔍 آیدی عددی یا یوزرنیم کاربر را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    case "📊 آمار کلی": {
      const stats = await getStats();
      const pool = await getPoolStats();
      await safeSend(chatId,
        `📊 <b>آمار کلی</b>\n\n👥 کاربران: ${stats.users}\n📦 سرویس‌های فعال: ${stats.services}\n${pe("star")} جمع سکه‌ها: ${stats.coins}\n\n🗂️ پول سرویس:\n✅ موجود: ${pool.available}\n📦 کل: ${pool.total}`
      );
      return true;
    }

    case "🏆 برترین دعوت‌ها": {
      const top = await getTopInviters(10);
      if (!top.length) { await safeSend(chatId, "❌ هنوز کسی دعوت نکرده."); return true; }
      let m = `🏆 <b>برترین دعوت‌ها</b>\n\n`;
      top.forEach((t, i) => {
        m += `${i + 1}. ${t.user.firstName}${t.user.username ? ` (@${t.user.username})` : ""} — ${t.count} نفر\n`;
      });
      await safeSend(chatId, m);
      return true;
    }

    case "👥 ۲۰ کاربر آخر": {
      const users = await getRecentUsers(20);
      if (!users.length) { await safeSend(chatId, "❌ کاربری وجود ندارد."); return true; }
      let m = `👥 <b>۲۰ کاربر آخر</b>\n\n`;
      users.forEach((u, i) => {
        m += `${i + 1}. ${u.firstName}${u.username ? ` (@${u.username})` : ""} | <code>${u.telegramId}</code>\n`;
      });
      await safeSend(chatId, m);
      return true;
    }

    case "➕ افزودن سکه":
      setState(userId, "await_add_coins_id");
      await safeSend(chatId, "➕ آیدی عددی یا یوزرنیم کاربر را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    case "➖ کم کردن سکه":
      setState(userId, "await_remove_coins_id");
      await safeSend(chatId, "➖ آیدی عددی یا یوزرنیم کاربر را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    case "🎁 سکه به همه":
      setState(userId, "await_broadcast_coins");
      await safeSend(chatId, "🎁 مقدار سکه‌ای که به همه داده میشه را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    case "⚙️ تنظیم سکه کاربر":
      setState(userId, "await_set_coins_id");
      await safeSend(chatId, "⚙️ آیدی عددی یا یوزرنیم کاربر را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    case "🚫 مسدود کردن":
      setState(userId, "await_block_id");
      await safeSend(chatId, "🚫 آیدی عددی یا یوزرنیم کاربر را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    case "✅ رفع مسدودیت":
      setState(userId, "await_unblock_id");
      await safeSend(chatId, "✅ آیدی عددی یا یوزرنیم کاربر را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    case "🗑️ حذف سرویس‌های کاربر":
      setState(userId, "await_delete_services_id");
      await safeSend(chatId, "🗑️ آیدی عددی یا یوزرنیم کاربر را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    case "📋 لیست مسدودها": {
      const blocked = await getBlockedUsers();
      if (!blocked.length) { await safeSend(chatId, "✅ هیچ کاربر مسدودی وجود ندارد."); return true; }
      let m = `📋 <b>لیست مسدودها</b> (${blocked.length} نفر)\n\n`;
      blocked.forEach((u, i) => {
        m += `${i + 1}. ${u.firstName}${u.username ? ` (@${u.username})` : ""} | <code>${u.telegramId}</code>\n`;
      });
      await safeSend(chatId, m);
      return true;
    }

    case "📢 پیام همگانی":
      setState(userId, "await_broadcast_message");
      await safeSend(chatId, "📢 پیام همگانی را بنویس:\n\n<i>HTML پشتیبانی می‌شه</i>", { reply_markup: cancelKeyboard });
      return true;

    case "✉️ پیام به یک کاربر":
      setState(userId, "await_dm_user_id");
      await safeSend(chatId, "✉️ آیدی عددی یا یوزرنیم کاربر را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    case "🛡️ مدیریت ادمین‌ها":
      await safeSend(chatId, "🛡️ مدیریت ادمین‌ها:", { reply_markup: adminManageKeyboard });
      return true;

    case "➕ افزودن ادمین":
      setState(userId, "await_add_admin_id");
      await safeSend(chatId, "➕ آیدی عددی ادمین جدید را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    case "➖ حذف ادمین":
      setState(userId, "await_remove_admin_id");
      await safeSend(chatId, "➖ آیدی عددی ادمین را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    case "📋 لیست ادمین‌ها": {
      const admins = await getAdmins();
      if (!admins.length) { await safeSend(chatId, "❌ هیچ ادمینی وجود ندارد."); return true; }
      let m = `🛡️ <b>لیست ادمین‌ها</b>\n\n`;
      admins.forEach((a, i) => {
        m += `${i + 1}. ${a.username ? `@${a.username}` : `ID: ${a.telegramId}`} — ${a.level === 2 ? "سوپر ادمین" : "ادمین"}\n`;
      });
      await safeSend(chatId, m);
      return true;
    }

    case "⚙️ تنظیمات ربات":
      await safeSend(chatId, "⚙️ تنظیمات ربات:", { reply_markup: botSettingsKeyboard });
      return true;

    case "📝 پیام خوش‌آمد":
      setState(userId, "await_set_welcome");
      await safeSend(chatId, "📝 پیام خوش‌آمد جدید را بنویس:", { reply_markup: cancelKeyboard });
      return true;

    case "📢 کانال اجباری":
      setState(userId, "await_set_mandatory_channel");
      await safeSend(chatId, "📢 یوزرنیم کانال اجباری را وارد کن (مثال: @channel)\nبرای حذف عدد 0 بزن:", { reply_markup: cancelKeyboard });
      return true;

    case "🎁 پاداش دعوت":
      setState(userId, "await_set_invite_reward");
      await safeSend(chatId, "🎁 تعداد سکه پاداش به ازای هر دعوت را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    case "💬 اطلاعات پشتیبانی":
      setState(userId, "await_set_support");
      await safeSend(chatId, "💬 یوزرنیم پشتیبان را وارد کن (مثال: @support):", { reply_markup: cancelKeyboard });
      return true;

    case "➕ افزودن سرویس به پول":
      setState(userId, "await_add_service_name");
      await safeSend(chatId, "➕ نام سرویس را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    case "📊 آمار پول سرویس": {
      const pool = await getPoolStats();
      await safeSend(chatId, `📊 <b>آمار پول سرویس</b>\n\n✅ موجود: ${pool.available}\n📦 کل: ${pool.total}`);
      return true;
    }

    case "🔙 بازگشت به پنل":
      await showAdminPanel(bot, chatId);
      return true;

    case "🟢 حالت تعمیر: خاموش 🔴":
    case "🔴 حالت تعمیر: روشن 🟢": {
      const current = (await getSetting("maintenance_mode")) === "true";
      await setSetting("maintenance_mode", current ? "false" : "true");
      await safeSend(chatId, `🔧 حالت تعمیر: ${!current ? "✅ روشن شد" : "❌ خاموش شد"}`, {
        reply_markup: adminPanelKeyboard(!current),
      });
      return true;
    }

    case "❌ بستن":
      await safeSend(chatId, "👤 به منوی کاربری برگشتی.", { reply_markup: userMenuKeyboard });
      return true;

    default:
      return false;
  }
}

async function handleStateInput(
  bot: TelegramBot,
  msg: TelegramBot.Message,
  state: ReturnType<typeof getState>,
  userId: number,
  chatId: number,
  username: string | undefined,
  firstName: string
) {
  const text = msg.text?.trim() ?? "";

  const resolveUser = async (input: string) => {
    if (/^\d+$/.test(input)) return getUserByTelegramId(parseInt(input, 10));
    return getUserByUsername(input);
  };

  const adminBack = async (msg2: string) => {
    const maintenance = (await getSetting("maintenance_mode")) === "true";
    await safeSend(chatId, msg2, { reply_markup: adminPanelKeyboard(maintenance) });
  };

  switch (state.action) {
    case "await_user_info_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      const invites = await getInviteCount(user.telegramId);
      const services = await getUserServices(user.telegramId);
      clearState(userId);
      await adminBack(
        `🔍 <b>اطلاعات کاربر</b>\n\n` +
        `👤 نام: ${user.firstName}\n` +
        `📌 یوزرنیم: ${user.username ? `@${user.username}` : "ندارد"}\n` +
        `🆔 آیدی: <code>${user.telegramId}</code>\n` +
        `${pe("star")} سکه: ${user.coins}\n` +
        `👥 دعوت‌ها: ${invites}\n` +
        `📦 سرویس‌ها: ${services.length}\n` +
        `🚫 وضعیت: ${user.isBlocked ? "مسدود" : "فعال"}\n` +
        `📅 عضویت: ${formatDate(user.joinedAt)}`
      );
      break;
    }

    case "await_add_coins_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      setState(userId, "await_add_coins_amount", { targetId: user.telegramId, targetName: user.firstName });
      await safeSend(chatId, `➕ مقدار سکه برای ${user.firstName} را وارد کن:`);
      break;
    }

    case "await_add_coins_amount": {
      const amount = parseInt(text, 10);
      if (isNaN(amount) || amount <= 0) { await safeSend(chatId, "❌ عدد معتبر وارد کن."); return; }
      await addCoins(Number(state.data.targetId), amount);
      clearState(userId);
      await adminBack(`✅ ${amount} سکه به ${state.data.targetName} اضافه شد.`);
      break;
    }

    case "await_remove_coins_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      setState(userId, "await_remove_coins_amount", { targetId: user.telegramId, targetName: user.firstName });
      await safeSend(chatId, `➖ مقدار سکه‌ای که از ${user.firstName} کم میشه را وارد کن:`);
      break;
    }

    case "await_remove_coins_amount": {
      const amount = parseInt(text, 10);
      if (isNaN(amount) || amount <= 0) { await safeSend(chatId, "❌ عدد معتبر وارد کن."); return; }
      await removeCoins(Number(state.data.targetId), amount);
      clearState(userId);
      await adminBack(`✅ ${amount} سکه از ${state.data.targetName} کم شد.`);
      break;
    }

    case "await_set_coins_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      setState(userId, "await_set_coins_amount", { targetId: user.telegramId, targetName: user.firstName });
      await safeSend(chatId, `⚙️ سکه ${user.firstName} را به چه عددی تنظیم کنم؟`);
      break;
    }

    case "await_set_coins_amount": {
      const amount = parseInt(text, 10);
      if (isNaN(amount) || amount < 0) { await safeSend(chatId, "❌ عدد معتبر وارد کن."); return; }
      await setCoins(Number(state.data.targetId), amount);
      clearState(userId);
      await adminBack(`✅ سکه ${state.data.targetName} به ${amount} تنظیم شد.`);
      break;
    }

    case "await_broadcast_coins": {
      const amount = parseInt(text, 10);
      if (isNaN(amount) || amount <= 0) { await safeSend(chatId, "❌ عدد معتبر وارد کن."); return; }
      await addCoinsToAll(amount);
      clearState(userId);
      await adminBack(`✅ ${amount} سکه به همه کاربران اضافه شد.`);
      break;
    }

    case "await_block_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      await blockUser(user.telegramId);
      clearState(userId);
      await adminBack(`🚫 کاربر ${user.firstName} مسدود شد.`);
      break;
    }

    case "await_unblock_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      await unblockUser(user.telegramId);
      clearState(userId);
      await adminBack(`✅ مسدودیت ${user.firstName} برداشته شد.`);
      break;
    }

    case "await_delete_services_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      await deleteUserServices(user.telegramId);
      clearState(userId);
      await adminBack(`🗑️ سرویس‌های ${user.firstName} حذف شد.`);
      break;
    }

    case "await_broadcast_message": {
      const allUsers = await getAllUsers();
      const ids = allUsers.map((u) => u.telegramId);
      await safeSend(chatId, `📢 در حال ارسال به ${ids.length} نفر...`);
      const result = await broadcastMessage(bot, ids, text);
      clearState(userId);
      await adminBack(`✅ ارسال تموم شد!\n\n✔️ موفق: ${result.success}\n❌ خطا: ${result.failed}`);
      break;
    }

    case "await_dm_user_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      setState(userId, "await_dm_message", { targetId: user.telegramId, targetName: user.firstName });
      await safeSend(chatId, `✉️ پیام برای ${user.firstName} را بنویس:`);
      break;
    }

    case "await_dm_message": {
      const sent = await safeSend(Number(state.data.targetId), text);
      clearState(userId);
      await adminBack(sent ? `✅ پیام به ${state.data.targetName} ارسال شد.` : `❌ ارسال ناموفق بود.`);
      break;
    }

    case "await_add_admin_id": {
      const tid = parseInt(text, 10);
      if (isNaN(tid)) { await safeSend(chatId, "❌ آیدی عددی معتبر وارد کن."); return; }
      const superAdmin = await isSuperAdmin(userId, username);
      if (!superAdmin) { await safeSend(chatId, "❌ فقط سوپر ادمین می‌تواند ادمین اضافه کند."); clearState(userId); return; }
      await addAdmin(tid, undefined, 1);
      clearState(userId);
      await safeSend(chatId, `✅ کاربر ${tid} به عنوان ادمین اضافه شد.`, { reply_markup: adminManageKeyboard });
      break;
    }

    case "await_remove_admin_id": {
      const tid = parseInt(text, 10);
      if (isNaN(tid)) { await safeSend(chatId, "❌ آیدی عددی معتبر وارد کن."); return; }
      const superAdmin = await isSuperAdmin(userId, username);
      if (!superAdmin) { await safeSend(chatId, "❌ فقط سوپر ادمین می‌تواند ادمین حذف کند."); clearState(userId); return; }
      await removeAdmin(tid);
      clearState(userId);
      await safeSend(chatId, `✅ ادمین ${tid} حذف شد.`, { reply_markup: adminManageKeyboard });
      break;
    }

    case "await_set_welcome":
      await setSetting("welcome_message", text);
      clearState(userId);
      await safeSend(chatId, "✅ پیام خوش‌آمد ذخیره شد.", { reply_markup: botSettingsKeyboard });
      break;

    case "await_set_mandatory_channel":
      if (text === "0") {
        await setSetting("mandatory_channel", "");
        clearState(userId);
        await safeSend(chatId, "✅ کانال اجباری حذف شد.", { reply_markup: botSettingsKeyboard });
      } else {
        const ch = text.startsWith("@") ? text : `@${text}`;
        await setSetting("mandatory_channel", ch);
        clearState(userId);
        await safeSend(chatId, `✅ کانال اجباری: ${ch}`, { reply_markup: botSettingsKeyboard });
      }
      break;

    case "await_set_invite_reward": {
      const n = parseInt(text, 10);
      if (isNaN(n) || n < 0) { await safeSend(chatId, "❌ عدد معتبر وارد کن."); return; }
      await setSetting("invite_reward", String(n));
      clearState(userId);
      await safeSend(chatId, `✅ پاداش دعوت: ${n} سکه`, { reply_markup: botSettingsKeyboard });
      break;
    }

    case "await_set_support": {
      const sup = text.startsWith("@") ? text : `@${text}`;
      await setSetting("support_username", sup);
      clearState(userId);
      await safeSend(chatId, `✅ پشتیبان: ${sup}`, { reply_markup: botSettingsKeyboard });
      break;
    }

    case "await_add_service_name":
      setState(userId, "await_add_service_config", { serviceName: text });
      await safeSend(chatId, "➕ کانفیگ یا لینک سرویس را وارد کن:");
      break;

    case "await_add_service_config":
      await addServiceToPool(String(state.data.serviceName), text);
      clearState(userId);
      await safeSend(chatId, `✅ سرویس «${state.data.serviceName}» به پول اضافه شد.`, { reply_markup: botSettingsKeyboard });
      break;

    case "await_set_channel":
      clearState(userId);
      break;

    default:
      clearState(userId);
  }
}

async function handleUserMessage(
  bot: TelegramBot,
  text: string,
  chatId: number,
  userId: number,
  username: string | undefined,
  firstName: string
) {
  const maintenance = (await getSetting("maintenance_mode")) === "true";
  if (maintenance) {
    await safeSend(chatId, "🔧 ربات در حال تعمیر است. لطفاً بعداً مراجعه کنید.");
    return;
  }

  const user = await getUserByTelegramId(userId);
  if (!user) {
    await safeSend(chatId, "لطفاً با /start شروع کن.");
    return;
  }

  if (user.isBlocked) {
    await safeSend(chatId, "🚫 حساب شما مسدود شده است.");
    return;
  }

  const channelOk = await checkMandatoryChannel(bot, chatId, userId);
  if (!channelOk) return;

  switch (text) {
    case "🎁 سرویس رایگان": {
      const existing = await getUserServices(userId);
      if (existing.length > 0) {
        await safeSend(chatId, `📦 شما قبلاً سرویس دریافت کردید.\nبرای مشاهده دکمه «📦 سرویس‌های من» را بزن.`);
        return;
      }
      const poolItem = await getServiceFromPool();
      if (!poolItem) {
        await safeSend(chatId, "❌ در حال حاضر سرویسی موجود نیست. بعداً مراجعه کنید.");
        return;
      }
      const service = await assignServiceToUser(poolItem.id, userId);
      if (!service) { await safeSend(chatId, "❌ خطا در دریافت سرویس."); return; }
      await safeSend(chatId,
        `${pe("star")} <b>سرویس رایگان شما</b>\n\n📦 نام: ${service.name}\n\n<code>${service.config}</code>\n\n✅ این کانفیگ فقط برای شماست.`
      );
      break;
    }

    case "📦 سرویس‌های من": {
      const services = await getUserServices(userId);
      if (!services.length) {
        await safeSend(chatId, "📦 شما هنوز سرویسی دریافت نکردید.\nاز «🎁 سرویس رایگان» استفاده کن.");
        return;
      }
      for (const s of services) {
        await safeSend(chatId, `📦 <b>${s.name}</b>\n\n<code>${s.config}</code>`);
      }
      break;
    }

    case "👤 اطلاعات حساب": {
      const invites = await getInviteCount(userId);
      const services = await getUserServices(userId);
      await safeSend(chatId,
        `👤 <b>اطلاعات حساب</b>\n\n` +
        `${pe("crown")} نام: ${user.firstName}\n` +
        `📌 یوزرنیم: ${user.username ? `@${user.username}` : "ندارد"}\n` +
        `🆔 آیدی: <code>${user.telegramId}</code>\n` +
        `${pe("star")} سکه: ${user.coins}\n` +
        `👥 دعوت‌ها: ${invites}\n` +
        `📦 سرویس‌ها: ${services.length}\n` +
        `📅 عضویت: ${formatDate(user.joinedAt)}`
      );
      break;
    }

    case "🎉 دعوت دوستان + پاداش": {
      const invites = await getInviteCount(userId);
      const reward = (await getSetting("invite_reward")) ?? "1";
      const botInfo = await bot.getMe();
      const link = `https://t.me/${botInfo.username}?start=${userId}`;
      await safeSend(chatId,
        `${pe("diamond")} <b>دعوت دوستان</b>\n\n` +
        `🎁 به ازای هر دعوت: ${reward} سکه\n` +
        `👥 دعوت‌های شما: ${invites} نفر\n\n` +
        `🔗 لینک دعوت شما:\n<code>${link}</code>`
      );
      break;
    }

    case "🛠 پشتیبانی": {
      const support = (await getSetting("support_username")) ?? "@support";
      const channel = (await getSetting("channel_username")) ?? "";
      await safeSend(chatId,
        `🛠 <b>پشتیبانی</b>\n\n👤 پشتیبان: ${support}\n${channel ? `📢 کانال: ${channel}` : ""}`
      );
      break;
    }

    default:
      await safeSend(chatId, "لطفاً از دکمه‌های منو استفاده کن.", { reply_markup: userMenuKeyboard });
  }
}
