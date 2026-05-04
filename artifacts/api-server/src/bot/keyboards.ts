import TelegramBot from "node-telegram-bot-api";

export const userMenuKeyboard: TelegramBot.ReplyKeyboardMarkup = {
  keyboard: [
    [{ text: "🎁 سرویس رایگان" }, { text: "📦 سرویس‌های من" }],
    [{ text: "👤 اطلاعات حساب" }, { text: "🎉 دعوت دوستان + پاداش" }],
    [{ text: "🛠 پشتیبانی" }],
  ],
  resize_keyboard: true,
};

export function adminPanelKeyboard(
  maintenanceMode: boolean
): TelegramBot.ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "🔍 اطلاعات کاربر" }, { text: "📊 آمار کلی" }],
      [{ text: "🏆 برترین دعوت‌ها" }, { text: "👥 ۲۰ کاربر آخر" }],
      [{ text: "➕ افزودن سکه" }, { text: "➖ کم کردن سکه" }],
      [{ text: "🎁 سکه به همه" }, { text: "⚙️ تنظیم سکه کاربر" }],
      [{ text: "🚫 مسدود کردن" }, { text: "✅ رفع مسدودیت" }],
      [{ text: "🗑️ حذف سرویس‌های کاربر" }, { text: "📋 لیست مسدودها" }],
      [{ text: "📢 پیام همگانی" }, { text: "✉️ پیام به یک کاربر" }],
      [{ text: "🛡️ مدیریت ادمین‌ها" }, { text: "⚙️ تنظیمات ربات" }],
      [
        {
          text: maintenanceMode
            ? "🔴 حالت تعمیر: روشن 🟢"
            : "🟢 حالت تعمیر: خاموش 🔴",
        },
      ],
      [{ text: "❌ بستن" }],
    ],
    resize_keyboard: true,
  };
}

export const botSettingsKeyboard: TelegramBot.ReplyKeyboardMarkup = {
  keyboard: [
    [{ text: "📝 پیام خوش‌آمد" }, { text: "📢 کانال اجباری" }],
    [{ text: "🎁 پاداش دعوت" }, { text: "💬 اطلاعات پشتیبانی" }],
    [{ text: "➕ افزودن سرویس به پول" }, { text: "📊 آمار پول سرویس" }],
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
