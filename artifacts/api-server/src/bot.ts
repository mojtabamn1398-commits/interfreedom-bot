import TelegramBot from "node-telegram-bot-api";
import { logger } from "./lib/logger";

let bot: TelegramBot | null = null;

export function startBot() {
  const token = process.env["TELEGRAM_BOT_TOKEN"];

  if (!token) {
    logger.warn("TELEGRAM_BOT_TOKEN not set, bot will not start");
    return;
  }

  bot = new TelegramBot(token, { polling: true });

  bot.on("polling_error", (err) => {
    logger.error({ err }, "Telegram polling error");
  });

  bot.on("message", (msg) => {
    logger.info({ chatId: msg.chat.id, text: msg.text }, "Message received");
  });

  logger.info("Telegram bot started successfully");
}

export function getBot() {
  return bot;
}
