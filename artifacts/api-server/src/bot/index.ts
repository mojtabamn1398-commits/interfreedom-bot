import TelegramBot from "node-telegram-bot-api";
import { logger } from "../lib/logger";
import { getState, setState, clearState } from "./state";
import {
  userMenuKeyboard,
  adminPanelKeyboard,
  userManageKeyboard,
  coinManageKeyboard,
  serviceManageKeyboard,
  messagingKeyboard,
  botSettingsKeyboard,
  adminManageKeyboard,
  cancelKeyboard,
} from "./keyboards";
import { pe, safeSend, setBotInstance, broadcastMessage, formatDate } from "./utils";
import {
  getOrCreateUser,
  grantReferralReward,
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
  createDirectService,
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

async function isMemberOfChannel(bot: TelegramBot, channel: string, userId: number): Promise<boolean> {
  try {
    const member = await bot.getChatMember(channel, userId);
    return ["member", "administrator", "creator"].includes(member.status);
  } catch {
    return true;
  }
}

async function checkMandatoryChannel(bot: TelegramBot, chatId: number, userId: number): Promise<boolean> {
  const channel = await getSetting("mandatory_channel");
  if (!channel) return true;
  const isMember = await isMemberOfChannel(bot, channel, userId);
  if (!isMember) {
    await safeSend(chatId, `⚠️ برای استفاده از ربات باید ابتدا در کانال ما عضو بشی:\n${channel}`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📢 عضویت در کانال", url: `https://t.me/${channel.replace("@", "")}` }],
          [{ text: "✅ عضو شدم، بررسی کن", callback_data: "check_joined" }],
        ],
      },
    });
    return false;
  }
  return true;
}

export function setupBot(bot: TelegramBot) {
  setBotInstance(bot);

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
          await safeSend(chatId, "❌ عملیات لغو شد.", { reply_markup: adminPanelKeyboard(maintenance) });
        } else {
          await safeSend(chatId, "❌ عملیات لغو شد.", { reply_markup: userMenuKeyboard });
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
        await handleAdminCommand(chatId, userId, username);
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

          const rewarded = await grantReferralReward(userId);
          if (rewarded) {
            const newUser = await getUserByTelegramId(userId);
            if (newUser?.referredBy) {
              const referrer = await getUserByTelegramId(newUser.referredBy);
              const rewardAmt = (await getSetting("invite_reward")) ?? "1";
              const invites = await getInviteCount(newUser.referredBy);
              await safeSend(newUser.referredBy,
                `🎉 یک زیرمجموعه جدید برات ثبت شد!\n` +
                `🪙 ${rewardAmt} سکه گرفتی.\n` +
                `👥 زیرمجموعه‌های موفق: ${invites}\n` +
                `💰 سکه فعلی: ${referrer?.coins ?? 0}`
              );
            }
          }

          await safeSend(chatId, "✅ عضویت تایید شد! حالا می‌تونی از ربات استفاده کنی.", {
            reply_markup: userMenuKeyboard,
          });
        } else {
          await bot.answerCallbackQuery(query.id, { text: "❌ هنوز عضو نشدی!", show_alert: true });
        }
      } else if (query.data === "get_free_coins") {
        await bot.answerCallbackQuery(query.id);
        const botInfo = await bot.getMe();
        const inviteLink = `https://t.me/${botInfo.username}?start=${userId}`;
        const reward = (await getSetting("invite_reward")) ?? "1";
        await safeSend(chatId,
          `💰 <b>دریافت سکه رایگان</b>\n\n` +
          `برای هر نفری که با لینک اختصاصی تو وارد ربات بشه، ${reward} سکه بهت تعلق می‌گیره!\n\n` +
          `🔗 لینک دعوت شما:\n<code>${inviteLink}</code>\n\n` +
          `لینک رو با دوستات به اشتراک بذار 👇`
        );
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

  const channel = await getSetting("mandatory_channel");
  if (channel) {
    const isMember = await isMemberOfChannel(bot, channel, userId);
    if (!isMember) {
      await safeSend(chatId, `سلام ${firstName} 👋\n\n⚠️ برای استفاده از ربات باید ابتدا عضو کانال ما بشی:`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📢 عضویت در کانال", url: `https://t.me/${channel.replace("@", "")}` }],
            [{ text: "✅ عضو شدم، بررسی کن", callback_data: "check_joined" }],
          ],
        },
      });
      return;
    }
  }

  if (isNew) {
    const rewarded = await grantReferralReward(userId);
    if (rewarded) {
      const newUser = await getUserByTelegramId(userId);
      if (newUser?.referredBy) {
        const referrer = await getUserByTelegramId(newUser.referredBy);
        const rewardAmt = (await getSetting("invite_reward")) ?? "1";
        const invites = await getInviteCount(newUser.referredBy);
        await safeSend(newUser.referredBy,
          `🎉 یک زیرمجموعه جدید برات ثبت شد!\n` +
          `🪙 ${rewardAmt} سکه گرفتی.\n` +
          `👥 زیرمجموعه‌های موفق: ${invites}\n` +
          `💰 سکه فعلی: ${referrer?.coins ?? 0}`
        );
      }
    }
  }

  const welcome = (await getSetting("welcome_message")) ?? "به ربات خوش اومدی!\nاز منوی پایین یکی از گزینه‌ها رو انتخاب کن.";
  await safeSend(chatId, `سلام ${firstName} 👋\n\n${welcome}`, { reply_markup: userMenuKeyboard });
}

async function handleAdminCommand(chatId: number, userId: number, username: string | undefined) {
  const adminUser = await isAdmin(userId, username);
  if (!adminUser) {
    await safeSend(chatId, "❌ شما دسترسی ادمین ندارید.");
    return;
  }
  await showAdminPanel(chatId);
}

async function showAdminPanel(chatId: number) {
  const stats = await getStats();
  const maintenance = (await getSetting("maintenance_mode")) === "true";
  const pool = await getPoolStats();
  const text =
    `🛡️ <b>پنل مدیریت</b>\n\n` +
    `👥 کاربران: ${stats.users}\n` +
    `📦 سرویس‌های فعال: ${stats.services}\n` +
    `🗂️ پول موجود: ${pool.available}\n` +
    `⭐ جمع سکه‌ها: ${stats.coins}\n\n` +
    `👇 یک بخش را انتخاب کن:`;
  await safeSend(chatId, text, { reply_markup: adminPanelKeyboard(maintenance) });
}

async function handleAdminMessage(
  bot: TelegramBot,
  text: string,
  chatId: number,
  userId: number,
  username: string | undefined
): Promise<boolean> {
  const adminBack = async (msg2: string) => {
    await showAdminPanel(chatId);
    if (msg2) await safeSend(chatId, msg2);
  };

  switch (text) {

    // ── Main panel sections ─────────────────────────────────────
    case "👥 مدیریت کاربران":
      await safeSend(chatId, "👥 <b>مدیریت کاربران</b>", { reply_markup: userManageKeyboard });
      return true;

    case "💰 مدیریت سکه":
      await safeSend(chatId, "💰 <b>مدیریت سکه</b>", { reply_markup: coinManageKeyboard });
      return true;

    case "📦 مدیریت سرویس":
      await safeSend(chatId, "📦 <b>مدیریت سرویس</b>", { reply_markup: serviceManageKeyboard });
      return true;

    case "📢 پیام‌رسانی":
      await safeSend(chatId, "📢 <b>پیام‌رسانی</b>", { reply_markup: messagingKeyboard });
      return true;

    case "⚙️ تنظیمات ربات":
      await safeSend(chatId, "⚙️ <b>تنظیمات ربات</b>", { reply_markup: botSettingsKeyboard });
      return true;

    case "🛡️ مدیریت ادمین‌ها":
      await safeSend(chatId, "🛡️ <b>مدیریت ادمین‌ها</b>", { reply_markup: adminManageKeyboard });
      return true;

    case "🔙 بازگشت به پنل":
      await showAdminPanel(chatId);
      return true;

    case "❌ بستن":
      await safeSend(chatId, "👤 به منوی کاربری برگشتی.", { reply_markup: userMenuKeyboard });
      return true;

    // ── آمار ────────────────────────────────────────────────────
    case "📊 آمار کلی": {
      const stats = await getStats();
      const pool = await getPoolStats();
      const top = await getTopInviters(3);
      let m = `📊 <b>آمار کلی</b>\n\n` +
        `👥 کل کاربران: ${stats.users}\n` +
        `📦 سرویس‌های فعال: ${stats.services}\n` +
        `⭐ جمع سکه‌ها: ${stats.coins}\n\n` +
        `🗂️ <b>پول سرویس</b>\n✅ موجود: ${pool.available} | 📦 کل: ${pool.total}\n\n` +
        `🏆 <b>برترین دعوت‌کنندگان</b>\n`;
      top.forEach((t, i) => {
        m += `${i + 1}. ${t.user.firstName} — ${t.count} نفر\n`;
      });
      await safeSend(chatId, m);
      return true;
    }

    // ── حالت تعمیر ───────────────────────────────────────────────
    case "🟢 حالت تعمیر: خاموش 🔴":
    case "🔴 حالت تعمیر: روشن 🟢": {
      const current = (await getSetting("maintenance_mode")) === "true";
      await setSetting("maintenance_mode", current ? "false" : "true");
      await safeSend(chatId, `🔧 حالت تعمیر: ${!current ? "✅ روشن شد" : "❌ خاموش شد"}`, {
        reply_markup: adminPanelKeyboard(!current),
      });
      return true;
    }

    // ── مدیریت کاربران ───────────────────────────────────────────
    case "🔍 اطلاعات کاربر":
      setState(userId, "await_user_info_id");
      await safeSend(chatId, "🔍 آیدی عددی یا یوزرنیم کاربر را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

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

    case "🚫 مسدود کردن":
      setState(userId, "await_block_id");
      await safeSend(chatId, "🚫 آیدی عددی یا یوزرنیم کاربر را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    case "✅ رفع مسدودیت":
      setState(userId, "await_unblock_id");
      await safeSend(chatId, "✅ آیدی عددی یا یوزرنیم کاربر را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    // ── مدیریت سکه ───────────────────────────────────────────────
    case "➕ افزودن سکه":
      setState(userId, "await_add_coins_id");
      await safeSend(chatId, "➕ آیدی عددی یا یوزرنیم کاربر را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    case "➖ کم کردن سکه":
      setState(userId, "await_remove_coins_id");
      await safeSend(chatId, "➖ آیدی عددی یا یوزرنیم کاربر را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    case "⚙️ تنظیم سکه کاربر":
      setState(userId, "await_set_coins_id");
      await safeSend(chatId, "⚙️ آیدی عددی یا یوزرنیم کاربر را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    case "🎁 سکه به همه":
      setState(userId, "await_broadcast_coins");
      await safeSend(chatId, "🎁 مقدار سکه‌ای که به همه داده میشه را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    case "💳 موجودی کاربر":
      setState(userId, "await_check_balance_id");
      await safeSend(chatId, "💳 آیدی عددی یا یوزرنیم کاربر را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    // ── مدیریت سرویس ─────────────────────────────────────────────
    case "🎁 اعطای سرویس دستی":
      setState(userId, "await_manual_service_id");
      await safeSend(chatId, "🎁 آیدی عددی یا یوزرنیم کاربری که سرویس دریافت کنه:", { reply_markup: cancelKeyboard });
      return true;

    case "🗑️ حذف سرویس کاربر":
      setState(userId, "await_delete_services_id");
      await safeSend(chatId, "🗑️ آیدی عددی یا یوزرنیم کاربر را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    case "📋 سرویس‌های کاربر":
      setState(userId, "await_user_services_id");
      await safeSend(chatId, "📋 آیدی عددی یا یوزرنیم کاربر را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    case "📊 آمار پول سرویس": {
      const pool = await getPoolStats();
      await safeSend(chatId, `📊 <b>آمار پول سرویس</b>\n\n✅ موجود: ${pool.available}\n📦 کل: ${pool.total}`);
      return true;
    }

    case "➕ افزودن سرویس به پول":
      setState(userId, "await_add_service_name");
      await safeSend(chatId, "➕ نام سرویس را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    case "🔗 تغییر کانفیگ پایه": {
      const current = (await getSetting("base_vless_config")) ?? "تنظیم نشده";
      setState(userId, "await_set_vless_config");
      await safeSend(chatId,
        `🔗 <b>کانفیگ پایه فعلی:</b>\n<code>${current}</code>\n\nکانفیگ جدید (بدون #نام) را وارد کن:`,
        { reply_markup: cancelKeyboard }
      );
      return true;
    }

    case "💰 هزینه سرویس": {
      const current = (await getSetting("service_cost")) ?? "4";
      setState(userId, "await_set_service_cost");
      await safeSend(chatId, `💰 هزینه فعلی: ${current} سکه\n\nهزینه جدید را وارد کن:`, { reply_markup: cancelKeyboard });
      return true;
    }

    // ── پیام‌رسانی ────────────────────────────────────────────────
    case "📢 پیام همگانی":
      setState(userId, "await_broadcast_message");
      await safeSend(chatId, "📢 پیام همگانی را بنویس:\n\n<i>ایموجی پریمیوم، bold، italic پشتیبانی می‌شه</i>", { reply_markup: cancelKeyboard });
      return true;

    case "✉️ پیام به یک کاربر":
      setState(userId, "await_dm_user_id");
      await safeSend(chatId, "✉️ آیدی عددی یا یوزرنیم کاربر را وارد کن:", { reply_markup: cancelKeyboard });
      return true;

    // ── تنظیمات ربات ─────────────────────────────────────────────
    case "📝 پیام خوش‌آمد":
      setState(userId, "await_set_welcome");
      await safeSend(chatId, "📝 پیام خوش‌آمد جدید را بنویس:", { reply_markup: cancelKeyboard });
      return true;

    case "📢 کانال اجباری": {
      const cur = (await getSetting("mandatory_channel")) || "ندارد";
      setState(userId, "await_set_mandatory_channel");
      await safeSend(chatId, `📢 کانال اجباری فعلی: ${cur}\n\nیوزرنیم جدید را وارد کن (مثال: @channel)\nبرای حذف عدد 0 بزن:`, { reply_markup: cancelKeyboard });
      return true;
    }

    case "🎁 پاداش دعوت": {
      const cur = (await getSetting("invite_reward")) ?? "1";
      setState(userId, "await_set_invite_reward");
      await safeSend(chatId, `🎁 پاداش فعلی: ${cur} سکه\n\nمقدار جدید را وارد کن:`, { reply_markup: cancelKeyboard });
      return true;
    }

    case "💬 اطلاعات پشتیبانی": {
      const cur = (await getSetting("support_username")) ?? "تنظیم نشده";
      setState(userId, "await_set_support");
      await safeSend(chatId, `💬 پشتیبان فعلی: ${cur}\n\nیوزرنیم جدید را وارد کن (مثال: @support):`, { reply_markup: cancelKeyboard });
      return true;
    }

    case "📺 یوزرنیم کانال": {
      const cur = (await getSetting("channel_username")) ?? "تنظیم نشده";
      setState(userId, "await_set_channel_username");
      await safeSend(chatId, `📺 کانال فعلی: ${cur}\n\nیوزرنیم کانال (برای نمایش) را وارد کن:`, { reply_markup: cancelKeyboard });
      return true;
    }

    // ── مدیریت ادمین‌ها ───────────────────────────────────────────
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
        m += `${i + 1}. ${a.username ? `@${a.username}` : `ID: ${a.telegramId}`} — ${a.level === 2 ? "👑 سوپر ادمین" : "🛡️ ادمین"}\n`;
      });
      await safeSend(chatId, m);
      return true;
    }

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

  const backToPanel = async (msg2: string) => {
    await safeSend(chatId, msg2);
    await showAdminPanel(chatId);
  };

  switch (state.action) {

    // ── کاربران ───────────────────────────────────────────────────
    case "await_user_info_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      const invites = await getInviteCount(user.telegramId);
      const services = await getUserServices(user.telegramId);
      clearState(userId);
      await safeSend(chatId,
        `🔍 <b>اطلاعات کاربر</b>\n\n` +
        `👤 نام: ${user.firstName}\n` +
        `📌 یوزرنیم: ${user.username ? `@${user.username}` : "ندارد"}\n` +
        `🆔 آیدی: <code>${user.telegramId}</code>\n` +
        `💰 سکه: ${user.coins}\n` +
        `👥 دعوت‌ها: ${invites}\n` +
        `📦 سرویس‌ها: ${services.length}\n` +
        `🚫 وضعیت: ${user.isBlocked ? "مسدود 🔴" : "فعال 🟢"}\n` +
        `📅 عضویت: ${formatDate(user.joinedAt)}`,
        { reply_markup: userManageKeyboard }
      );
      break;
    }

    case "await_block_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      await blockUser(user.telegramId);
      clearState(userId);
      await safeSend(chatId, `🚫 کاربر ${user.firstName} مسدود شد.`, { reply_markup: userManageKeyboard });
      break;
    }

    case "await_unblock_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      await unblockUser(user.telegramId);
      clearState(userId);
      await safeSend(chatId, `✅ مسدودیت ${user.firstName} برداشته شد.`, { reply_markup: userManageKeyboard });
      break;
    }

    // ── سکه ──────────────────────────────────────────────────────
    case "await_check_balance_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      clearState(userId);
      await safeSend(chatId,
        `💳 <b>موجودی کاربر</b>\n\n👤 ${user.firstName}\n🆔 <code>${user.telegramId}</code>\n💰 سکه: ${user.coins}`,
        { reply_markup: coinManageKeyboard }
      );
      break;
    }

    case "await_add_coins_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      setState(userId, "await_add_coins_amount", { targetId: user.telegramId, targetName: user.firstName });
      await safeSend(chatId, `➕ مقدار سکه برای ${user.firstName} (سکه فعلی: ${user.coins}) را وارد کن:`);
      break;
    }

    case "await_add_coins_amount": {
      const amount = parseInt(text, 10);
      if (isNaN(amount) || amount <= 0) { await safeSend(chatId, "❌ عدد معتبر وارد کن."); return; }
      await addCoins(Number(state.data.targetId), amount);
      clearState(userId);
      await safeSend(chatId, `✅ ${amount} سکه به ${state.data.targetName} اضافه شد.`, { reply_markup: coinManageKeyboard });
      break;
    }

    case "await_remove_coins_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      setState(userId, "await_remove_coins_amount", { targetId: user.telegramId, targetName: user.firstName });
      await safeSend(chatId, `➖ مقدار سکه از ${user.firstName} (سکه فعلی: ${user.coins}):`);
      break;
    }

    case "await_remove_coins_amount": {
      const amount = parseInt(text, 10);
      if (isNaN(amount) || amount <= 0) { await safeSend(chatId, "❌ عدد معتبر وارد کن."); return; }
      await removeCoins(Number(state.data.targetId), amount);
      clearState(userId);
      await safeSend(chatId, `✅ ${amount} سکه از ${state.data.targetName} کم شد.`, { reply_markup: coinManageKeyboard });
      break;
    }

    case "await_set_coins_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      setState(userId, "await_set_coins_amount", { targetId: user.telegramId, targetName: user.firstName });
      await safeSend(chatId, `⚙️ سکه ${user.firstName} (فعلاً: ${user.coins}) را به چه عددی تنظیم کنم؟`);
      break;
    }

    case "await_set_coins_amount": {
      const amount = parseInt(text, 10);
      if (isNaN(amount) || amount < 0) { await safeSend(chatId, "❌ عدد معتبر وارد کن."); return; }
      await setCoins(Number(state.data.targetId), amount);
      clearState(userId);
      await safeSend(chatId, `✅ سکه ${state.data.targetName} به ${amount} تنظیم شد.`, { reply_markup: coinManageKeyboard });
      break;
    }

    case "await_broadcast_coins": {
      const amount = parseInt(text, 10);
      if (isNaN(amount) || amount <= 0) { await safeSend(chatId, "❌ عدد معتبر وارد کن."); return; }
      await addCoinsToAll(amount);
      clearState(userId);
      await safeSend(chatId, `✅ ${amount} سکه به همه کاربران اضافه شد.`, { reply_markup: coinManageKeyboard });
      break;
    }

    // ── سرویس ────────────────────────────────────────────────────
    case "await_manual_service_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      const baseConfig = (await getSetting("base_vless_config")) ??
        "vless://80dafdc7-38fa-4cf6-8b05-83e52c97d876@185.143.234.235:80?security=&encryption=none&host=vixon.portab.org&type=ws";
      const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
      const userConfig = `${baseConfig}#IF-${user.telegramId}-${suffix}`;
      await createDirectService(user.telegramId, "InterFreedom VPN", userConfig);
      clearState(userId);
      await safeSend(chatId,
        `✅ سرویس به ${user.firstName} اعطا شد.\n\n<code>${userConfig}</code>`,
        { reply_markup: serviceManageKeyboard }
      );
      break;
    }

    case "await_user_services_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      const services = await getUserServices(user.telegramId);
      clearState(userId);
      if (!services.length) {
        await safeSend(chatId, `📋 ${user.firstName} هیچ سرویس فعالی ندارد.`, { reply_markup: serviceManageKeyboard });
      } else {
        let m = `📋 <b>سرویس‌های ${user.firstName}</b>\n\n`;
        services.forEach((s, i) => {
          m += `${i + 1}. ${s.name}\n<code>${s.config}</code>\n\n`;
        });
        await safeSend(chatId, m, { reply_markup: serviceManageKeyboard });
      }
      break;
    }

    case "await_delete_services_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      await deleteUserServices(user.telegramId);
      clearState(userId);
      await safeSend(chatId, `🗑️ سرویس‌های ${user.firstName} حذف شد.`, { reply_markup: serviceManageKeyboard });
      break;
    }

    case "await_add_service_name":
      setState(userId, "await_add_service_config", { serviceName: text });
      await safeSend(chatId, "➕ کانفیگ یا لینک سرویس را وارد کن:");
      break;

    case "await_add_service_config":
      await addServiceToPool(String(state.data.serviceName), text);
      clearState(userId);
      await safeSend(chatId, `✅ سرویس «${state.data.serviceName}» به پول اضافه شد.`, { reply_markup: serviceManageKeyboard });
      break;

    case "await_set_vless_config": {
      const clean = text.replace(/#.*$/, "").trim();
      await setSetting("base_vless_config", clean);
      clearState(userId);
      await safeSend(chatId, `✅ کانفیگ پایه ذخیره شد.`, { reply_markup: serviceManageKeyboard });
      break;
    }

    case "await_set_service_cost": {
      const n = parseInt(text, 10);
      if (isNaN(n) || n < 0) { await safeSend(chatId, "❌ عدد معتبر وارد کن."); return; }
      await setSetting("service_cost", String(n));
      clearState(userId);
      await safeSend(chatId, `✅ هزینه سرویس: ${n} سکه`, { reply_markup: serviceManageKeyboard });
      break;
    }

    // ── پیام‌رسانی ────────────────────────────────────────────────
    case "await_broadcast_message": {
      const allUsers = await getAllUsers();
      const ids = allUsers.map((u) => u.telegramId);
      await safeSend(chatId, `📢 در حال ارسال به ${ids.length} نفر...`);
      const result = await broadcastMessage(bot, ids, text, msg.entities);
      clearState(userId);
      await safeSend(chatId,
        `✅ ارسال تموم شد!\n\n✔️ موفق: ${result.success}\n❌ خطا: ${result.failed}`,
        { reply_markup: messagingKeyboard }
      );
      break;
    }

    case "await_dm_user_id": {
      const user = await resolveUser(text);
      if (!user) { await safeSend(chatId, "❌ کاربر پیدا نشد."); clearState(userId); return; }
      setState(userId, "await_dm_message", { targetId: user.telegramId, targetName: user.firstName });
      await safeSend(chatId, `✉️ پیام برای ${user.firstName} را بنویس:\n(ایموجی پریمیوم پشتیبانی می‌شه)`);
      break;
    }

    case "await_dm_message": {
      const dmOpts: TelegramBot.SendMessageOptions = msg.entities && msg.entities.length > 0
        ? { entities: msg.entities }
        : { parse_mode: "HTML" };
      let sent = false;
      try {
        await bot.sendMessage(Number(state.data.targetId), text, dmOpts);
        sent = true;
      } catch { sent = false; }
      clearState(userId);
      await safeSend(chatId,
        sent ? `✅ پیام به ${state.data.targetName} ارسال شد.` : `❌ ارسال ناموفق بود.`,
        { reply_markup: messagingKeyboard }
      );
      break;
    }

    // ── ادمین ────────────────────────────────────────────────────
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

    // ── تنظیمات ──────────────────────────────────────────────────
    case "await_set_welcome":
      await setSetting("welcome_message", text);
      clearState(userId);
      await safeSend(chatId, "✅ پیام خوش‌آمد ذخیره شد.", { reply_markup: botSettingsKeyboard });
      break;

    case "await_set_mandatory_channel": {
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
      await safeSend(chatId, `✅ پشتیبان: ${sup}`, { reply_markup: botSettingsKeyboard });
      break;
    }

    case "await_set_channel_username": {
      const ch = text.startsWith("@") ? text : `@${text}`;
      await setSetting("channel_username", ch);
      clearState(userId);
      await safeSend(chatId, `✅ یوزرنیم کانال: ${ch}`, { reply_markup: botSettingsKeyboard });
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

  const channelOk = await checkMandatoryChannel(bot, chatId, userId);
  if (!channelOk) return;

  switch (text) {
    case "🎁 سرویس رایگان": {
      const costStr = (await getSetting("service_cost")) ?? "4";
      const cost = parseInt(costStr, 10);
      const freshUser = await getUserByTelegramId(userId);
      const coins = freshUser?.coins ?? 0;

      if (coins < cost) {
        await safeSend(chatId,
          `🎁 برای دریافت سرویس رایگان به ${cost} سکه نیاز داری.\n\n` +
          `💰 سکه فعلی شما: ${coins}\n` +
          `❗️ متاسفانه ${cost - coins} سکه دیگه لازم داری.\n\n` +
          `برای دریافت سکه رایگان روی دکمه پایین بزن 👇`,
          { reply_markup: { inline_keyboard: [[{ text: "🎁 دریافت سکه رایگان", callback_data: "get_free_coins" }]] } }
        );
        return;
      }

      const existing = await getUserServices(userId);
      if (existing.length > 0) {
        await safeSend(chatId, `📦 شما قبلاً سرویس دریافت کردید.\nبرای مشاهده دکمه «📦 سرویس‌های من» را بزن.`);
        return;
      }

      const baseConfig = (await getSetting("base_vless_config")) ??
        "vless://80dafdc7-38fa-4cf6-8b05-83e52c97d876@185.143.234.235:80?security=&encryption=none&host=vixon.portab.org&type=ws";
      const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
      const userConfig = `${baseConfig}#IF-${userId}-${suffix}`;

      await removeCoins(userId, cost);
      await createDirectService(userId, "InterFreedom VPN", userConfig);

      await safeSend(chatId,
        `✅ <b>سرویس شما آماده‌ست!</b>\n\n` +
        `📦 نام: InterFreedom VPN\n\n` +
        `<code>${userConfig}</code>\n\n` +
        `💰 ${cost} سکه از حسابت کم شد.`
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
      const freshUser2 = await getUserByTelegramId(userId);
      await safeSend(chatId,
        `👤 <b>اطلاعات حساب شما</b>\n\n` +
        `🆔 آیدی عددی: <code>${userId}</code>\n` +
        `👤 نام: ${user.firstName}\n` +
        `💰 موجودی سکه: ${freshUser2?.coins ?? user.coins}\n` +
        `👥 زیرمجموعه‌های موفق: ${invites}\n` +
        `📦 تعداد سرویس‌ها: ${services.length}`
      );
      break;
    }

    case "🎉 دعوت دوستان + پاداش": {
      const invites = await getInviteCount(userId);
      const reward = (await getSetting("invite_reward")) ?? "1";
      const botInfo = await bot.getMe();
      const link = `https://t.me/${botInfo.username}?start=${userId}`;
      await safeSend(chatId,
        `💎 <b>دعوت دوستان</b>\n\n` +
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
        `🛠 <b>پشتیبانی</b>\n\n👤 پشتیبان: ${support}${channel ? `\n📢 کانال: ${channel}` : ""}`
      );
      break;
    }

    default:
      await safeSend(chatId, "لطفاً از دکمه‌های منو استفاده کن.", { reply_markup: userMenuKeyboard });
  }
}
