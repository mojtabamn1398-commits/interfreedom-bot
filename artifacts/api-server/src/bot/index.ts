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
import {
  pe,
  safeSend,
  broadcastMessage,
  formatDate,
} from "./utils";
import {
  getOrCreateUser,
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

export function setupBot(bot: TelegramBot) {
  setupCallbackQuery(bot);
  bot.on("message", async (msg) => {
    if (!msg.text || !msg.from) return;
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    const firstName = msg.from.first_name ?? "کاربر";
    const text = msg.text.trim();

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
    }
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

  await getOrCreateUser(userId, username, firstName, referredBy);

  const welcome = (await getSetting("welcome_message")) ?? "سلام! به ربات خوش آمدی 👋";
  const channel = await getSetting("channel_username");

  let welcomeText = `${pe("star")} ${welcome}\n\n👤 خوش آمدی ${firstName}!`;
  if (channel) welcomeText += `\n\n📢 کانال ما: ${channel}`;

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
  await safeSend(chatId, text, {
    reply_markup: adminPanelKeyboard(maintenance),
  });
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
      await safeSend(
        chatId,
        `📊 <b>آمار کلی</b>\n\n👥 کاربران: ${stats.users}\n📦 سرویس‌های فعال: ${stats.services}\n${pe("star")} جمع سکه‌ها: ${stats.coins}\n\n🗂️ پول سرویس:\n✅ موجود: ${pool.available}\n📦 کل: ${pool.total}`
      );
      return true;
    }

    case "🏆 برترین دعوت‌ها": {
      const top = await getTopInviters(10);
      if (!top.length) {
        await safeSend(chatId, "❌ هنوز کسی دعوت نکرده.");
        return true;
      }
      let msg = `🏆 <b>برترین دعوت‌ها</b>\n\n`;
      top.forEach((t, i) => {
        const u = t.user;
        msg += `${i + 1}. ${u.firstName}${u.username ? ` (@${u.username})` : ""} — ${t.count} نفر\n`;
      });
      await safeSend(chatId, msg);
      return true;
    }

    case "👥 ۲۰ کاربر آخر": {
      const users = await getRecentUsers(20);
      if (!users.length) {
        await safeSend(chatId, "❌ کاربری وجود ندارد.");
        return true;
      }
      let msg = `👥 <b>۲۰ کاربر آخر</b>\n\n`;
      users.forEach((u, i) => {
        msg += `${i + 1}. ${u.firstName}${u.username ? ` (@${u.username})` : ""} | آیدی: <code>${u.telegramId}</code>\n`;
      });
      await safeSend(chatId, msg);
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
      if (!blocked.length) {
        await safeSend(chatId, "✅ هیچ کاربر مسدودی وجود ندارد.");
        return true;
      }
      let msg = `📋 <b>لیست مسدودها</b> (${blocked.length} نفر)\n\n`;
      blocked.forEach((u, i) => {
        msg += `${i + 1}. ${u.firstName}${u.username ? ` (@${u.username})` : ""} | <code>${u.telegramId}</code>\n`;
      });
      await safeSend(chatId, msg);
      return true;
    }

    case "📢 پیام همگانی":
      setState(userId, "await_broadcast_message");
      await safeSend(chatId, "📢 پیام همگانی را بنویس:\n\n<i>HTML پشتیبانی می‌شه (bold، italic و...)</i>", { reply_markup: cancelKeyboard });
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
      if (!admins.length) {
        await safeSend(chatId, "❌ هیچ ادمینی وجود ندارد.");
        return true;
      }
      let msg = `🛡️ <b>لیست ادمین‌ها</b>\n\n`;
      admins.forEach((a, i) => {
        msg += `${i + 1}. ${a.username ? `@${a.username}` : `ID: ${a.telegramId}`} — سطح ${a.level === 2 ? "سوپر ادمین" : "ادمین"}\n`;
      });
      await safeSend(chatId, msg);
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
      await safeSend(
        chatId,
        `🔧 حالت تعمیر: ${!current ? "✅ روشن شد" : "❌ خاموش شد"}`,
        { reply_markup: adminPanelKeyboard(!current) }
      );
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
    if (/^\d+$/.test(input)) {
      return getUserByTelegramId(parseInt(input, 10));
    }
    return getUserByUsername(input);
  };

  switch (state.action) {
    case "await_user_info_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      const invites = await getInviteCount(user.telegramId);
      const services = await getUserServices(user.telegramId);
      const info =
        `🔍 <b>اطلاعات کاربر</b>\n\n` +
        `👤 نام: ${user.firstName}\n` +
        `📌 یوزرنیم: ${user.username ? `@${user.username}` : "ندارد"}\n` +
        `🆔 آیدی: <code>${user.telegramId}</code>\n` +
        `${pe("star")} سکه: ${user.coins}\n` +
        `👥 دعوت‌ها: ${invites}\n` +
        `📦 سرویس‌ها: ${services.length}\n` +
        `🚫 وضعیت: ${user.isBlocked ? "مسدود" : "فعال"}\n` +
        `📅 تاریخ عضویت: ${formatDate(user.joinedAt)}`;
      clearState(userId);
      const maintenance = (await getSetting("maintenance_mode")) === "true";
      await safeSend(chatId, info, { reply_markup: adminPanelKeyboard(maintenance) });
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
      const maintenance = (await getSetting("maintenance_mode")) === "true";
      await safeSend(chatId, `✅ ${amount} سکه به ${state.data.targetName} اضافه شد.`, { reply_markup: adminPanelKeyboard(maintenance) });
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
      const maintenance = (await getSetting("maintenance_mode")) === "true";
      await safeSend(chatId, `✅ ${amount} سکه از ${state.data.targetName} کم شد.`, { reply_markup: adminPanelKeyboard(maintenance) });
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
      const maintenance = (await getSetting("maintenance_mode")) === "true";
      await safeSend(chatId, `✅ سکه ${state.data.targetName} به ${amount} تنظیم شد.`, { reply_markup: adminPanelKeyboard(maintenance) });
      break;
    }

    case "await_broadcast_coins" as ConversationAction: {
      const amount = parseInt(text, 10);
      if (isNaN(amount) || amount <= 0) { await safeSend(chatId, "❌ عدد معتبر وارد کن."); return; }
      await addCoinsToAll(amount);
      clearState(userId);
      const maintenance = (await getSetting("maintenance_mode")) === "true";
      await safeSend(chatId, `✅ ${amount} سکه به همه کاربران اضافه شد.`, { reply_markup: adminPanelKeyboard(maintenance) });
      break;
    }

    case "await_block_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      await blockUser(user.telegramId);
      clearState(userId);
      const maintenance = (await getSetting("maintenance_mode")) === "true";
      await safeSend(chatId, `🚫 کاربر ${user.firstName} مسدود شد.`, { reply_markup: adminPanelKeyboard(maintenance) });
      break;
    }

    case "await_unblock_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      await unblockUser(user.telegramId);
      clearState(userId);
      const maintenance = (await getSetting("maintenance_mode")) === "true";
      await safeSend(chatId, `✅ مسدودیت ${user.firstName} برداشته شد.`, { reply_markup: adminPanelKeyboard(maintenance) });
      break;
    }

    case "await_delete_services_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      await deleteUserServices(user.telegramId);
      clearState(userId);
      const maintenance = (await getSetting("maintenance_mode")) === "true";
      await safeSend(chatId, `🗑️ سرویس‌های ${user.firstName} حذف شد.`, { reply_markup: adminPanelKeyboard(maintenance) });
      break;
    }

    case "await_broadcast_message": {
      const allUsers = await getAllUsers();
      const ids = allUsers.map((u) => u.telegramId);
      await safeSend(chatId, `📢 در حال ارسال به ${ids.length} نفر...`);
      const result = await broadcastMessage(bot, ids, text);
      clearState(userId);
      const maintenance = (await getSetting("maintenance_mode")) === "true";
      await safeSend(
        chatId,
        `✅ ارسال تموم شد!\n\n✔️ موفق: ${result.success}\n❌ خطا: ${result.failed}`,
        { reply_markup: adminPanelKeyboard(maintenance) }
      );
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
      const maintenance = (await getSetting("maintenance_mode")) === "true";
      await safeSend(chatId, sent ? `✅ پیام به ${state.data.targetName} ارسال شد.` : `❌ ارسال ناموفق بود.`, { reply_markup: adminPanelKeyboard(maintenance) });
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

    case "await_set_welcome": {
      await setSetting("welcome_message", text);
      clearState(userId);
      await safeSend(chatId, "✅ پیام خوش‌آمد ذخیره شد.", { reply_markup: botSettingsKeyboard });
      break;
    }

    case "await_set_mandatory_channel": {
      if (text === "0") {
        await setSetting("mandatory_channel", "");
        clearState(userId);
        await safeSend(chatId, "✅ کانال اجباری حذف شد.", { reply_markup: botSettingsKeyboard });
      } else {
        const ch = text.startsWith("@") ? text : `@${text}`;
        await setSetting("mandatory_channel", ch);
        clearState(userId);
        await safeSend(chatId, `✅ کانال اجباری تنظیم شد: ${ch}`, { reply_markup: botSettingsKeyboard });
      }
      break;
    }

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
      await safeSend(chatId, `✅ پشتیبان تنظیم شد: ${sup}`, { reply_markup: botSettingsKeyboard });
      break;
    }

    case "await_add_service_name": {
      setState(userId, "await_add_service_config", { serviceName: text });
      await safeSend(chatId, "➕ کانفیگ یا لینک سرویس را وارد کن:");
      break;
    }

    case "await_add_service_config": {
      await addServiceToPool(String(state.data.serviceName), text);
      clearState(userId);
      await safeSend(chatId, `✅ سرویس «${state.data.serviceName}» به پول اضافه شد.`, { reply_markup: botSettingsKeyboard });
      break;
    }

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

  const mandatoryChannel = await getSetting("mandatory_channel");

  const checkChannel = async (): Promise<boolean> => {
    if (!mandatoryChannel) return true;
    try {
      const member = await bot.getChatMember(mandatoryChannel, userId);
      return ["member", "administrator", "creator"].includes(member.status);
    } catch {
      return true;
    }
  };

  switch (text) {
    case "🎁 سرویس رایگان": {
      const isMember = await checkChannel();
      if (!isMember) {
        await safeSend(chatId, `⚠️ برای دریافت سرویس رایگان، ابتدا در کانال ما عضو شو:\n${mandatoryChannel}`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: "📢 عضویت در کانال", url: `https://t.me/${mandatoryChannel?.replace("@", "")}` }],
              [{ text: "✅ عضو شدم", callback_data: "check_joined" }],
            ],
          },
        });
        return;
      }

      const existing = await getUserServices(userId);
      if (existing.length > 0) {
        await safeSend(chatId, `📦 شما قبلاً سرویس دریافت کردید.\nبرای مشاهده: «📦 سرویس‌های من» را بزن.`);
        return;
      }

      const poolItem = await getServiceFromPool();
      if (!poolItem) {
        await safeSend(chatId, "❌ در حال حاضر سرویسی موجود نیست. بعداً مراجعه کنید.");
        return;
      }

      const service = await assignServiceToUser(poolItem.id, userId);
      if (!service) {
        await safeSend(chatId, "❌ خطا در دریافت سرویس.");
        return;
      }

      await safeSend(
        chatId,
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
      const info =
        `👤 <b>اطلاعات حساب</b>\n\n` +
        `${pe("crown")} نام: ${user.firstName}\n` +
        `📌 یوزرنیم: ${user.username ? `@${user.username}` : "ندارد"}\n` +
        `🆔 آیدی: <code>${user.telegramId}</code>\n` +
        `${pe("star")} سکه: ${user.coins}\n` +
        `👥 دعوت‌ها: ${invites}\n` +
        `📦 سرویس‌ها: ${services.length}\n` +
        `📅 عضویت: ${formatDate(user.joinedAt)}`;
      await safeSend(chatId, info);
      break;
    }

    case "🎉 دعوت دوستان + پاداش": {
      const invites = await getInviteCount(userId);
      const reward = (await getSetting("invite_reward")) ?? "1";
      const link = `https://t.me/${(await bot.getMe()).username}?start=${userId}`;
      await safeSend(
        chatId,
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
      await safeSend(
        chatId,
        `🛠 <b>پشتیبانی</b>\n\n👤 پشتیبان: ${support}\n${channel ? `📢 کانال: ${channel}` : ""}`
      );
      break;
    }

    default:
      await safeSend(chatId, "لطفاً از دکمه‌های منو استفاده کن.", { reply_markup: userMenuKeyboard });
  }
}

function setupCallbackQuery(bot: TelegramBot) {
  bot.on("callback_query", async (query) => {
    if (!query.data || !query.from || !query.message) return;
    const chatId = query.message.chat.id;
    const userId = query.from.id;

    if (query.data === "check_joined") {
      const mandatoryChannel = await getSetting("mandatory_channel");
      if (!mandatoryChannel) {
        await bot.answerCallbackQuery(query.id, { text: "✅ اوکیه!" });
        return;
      }
      try {
        const member = await bot.getChatMember(mandatoryChannel, userId);
        if (["member", "administrator", "creator"].includes(member.status)) {
          await bot.answerCallbackQuery(query.id, { text: "✅ عضویت تایید شد!" });
          const existing = await getUserServices(userId);
          if (existing.length > 0) {
            await safeSend(chatId, "📦 شما قبلاً سرویس دریافت کردید.");
            return;
          }
          const poolItem = await getServiceFromPool();
          if (!poolItem) {
            await safeSend(chatId, "❌ در حال حاضر سرویسی موجود نیست.");
            return;
          }
          const service = await assignServiceToUser(poolItem.id, userId);
          if (service) {
            await safeSend(chatId, `${pe("star")} <b>سرویس رایگان شما</b>\n\n📦 ${service.name}\n\n<code>${service.config}</code>`);
          }
        } else {
          await bot.answerCallbackQuery(query.id, { text: "❌ هنوز عضو نشدی!", show_alert: true });
        }
      } catch {
        await bot.answerCallbackQuery(query.id, { text: "خطا در بررسی عضویت" });
      }
    }
  });
}
