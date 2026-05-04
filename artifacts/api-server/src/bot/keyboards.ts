import TelegramBot from "node-telegram-bot-api";

export const userMenuKeyboard: TelegramBot.ReplyKeyboardMarkup = {
  keyboard: [
    [{ text: "🎁 سرویس رایگان" }, { text: "📦 سرویس‌های من" }],
    [{ text: "👤 اطلاعات حساب" }, { text: "🎉 دعوت دوستان + پاداش" }],
    [{ text: "🛠 پشتیبانی" }],
  ],
  resize_keyboard: true,
};

export function adminPanelKeyboard(maintenanceMode: boolean): TelegramBot.ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "👥 مدیریت کاربران" }, { text: "💰 مدیریت سکه" }],
      [{ text: "📦 مدیریت سرویس" }, { text: "📢 پیام‌رسانی" }],
      [{ text: "⚙️ تنظیمات ربات" }, { text: "🛡️ مدیریت ادمین‌ها" }],
      [{ text: "📊 آمار کلی" }],
      [{ text: maintenanceMode ? "🔴 حالت تعمیر: روشن 🟢" : "🟢 حالت تعمیر: خاموش 🔴" }],
      [{ text: "❌ بستن" }],
    ],
    resize_keyboard: true,
  };
}

export const userManageKeyboard: TelegramBot.ReplyKeyboardMarkup = {
  keyboard: [
    [{ text: "🔍 اطلاعات کاربر" }, { text: "👥 ۲۰ کاربر آخر" }],
    [{ text: "🏆 برترین دعوت‌ها" }, { text: "📋 لیست مسدودها" }],
    [{ text: "🚫 مسدود کردن" }, { text: "✅ رفع مسدودیت" }],
    [{ text: "🔙 بازگشت به پنل" }],
  ],
  resize_keyboard: true,
};

export const coinManageKeyboard: TelegramBot.ReplyKeyboardMarkup = {
  keyboard: [
    [{ text: "➕ افزودن سکه" }, { text: "➖ کم کردن سکه" }],
    [{ text: "⚙️ تنظیم سکه کاربر" }, { text: "🎁 سکه به همه" }],
    [{ text: "💳 موجودی کاربر" }],
    [{ text: "🔙 بازگشت به پنل" }],
  ],
  resize_keyboard: true,
};

export const serviceManageKeyboard: TelegramBot.ReplyKeyboardMarkup = {
  keyboard: [
    [{ text: "🎁 اعطای سرویس دستی" }, { text: "🗑️ حذف سرویس کاربر" }],
    [{ text: "📋 سرویس‌های کاربر" }, { text: "📊 آمار پول سرویس" }],
    [{ text: "➕ افزودن سرویس به پول" }, { text: "🔗 تغییر کانفیگ پایه" }],
    [{ text: "💰 هزینه سرویس" }],
    [{ text: "🔙 بازگشت به پنل" }],
  ],
  resize_keyboard: true,
};

export const messagingKeyboard: TelegramBot.ReplyKeyboardMarkup = {
  keyboard: [
    [{ text: "📢 پیام همگانی" }, { text: "✉️ پیام به یک کاربر" }],
    [{ text: "🔙 بازگشت به پنل" }],
  ],
  resize_keyboard: true,
};

export const botSettingsKeyboard: TelegramBot.ReplyKeyboardMarkup = {
  keyboard: [
    [{ text: "📝 پیام خوش‌آمد" }, { text: "📢 کانال اجباری" }],
    [{ text: "🎁 پاداش دعوت" }, { text: "💬 اطلاعات پشتیبانی" }],
    [{ text: "📺 یوزرنیم کانال" }],
    [{ text: "🔙 بازگشت به پنل" }],
  ],
  resize_keyboard: true,
};

export const adminManageKeyboard: TelegramBot.ReplyKeyboardMarkup = {
  keyboard: [
    [{ text: "➕ افزودن ادمین" }, { text: "➖ حذف ادمین" }],
    [{ text: "📋 لیست ادمین‌ها" }],
    [{ text: "🔙 بازگشت به پنل" }],
  ],
  resize_keyboard: true,
};

export const cancelKeyboard: TelegramBot.ReplyKeyboardMarkup = {
  keyboard: [[{ text: "❌ انصراف" }]],
  resize_keyboard: true,
};
