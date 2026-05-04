import TelegramBot from "node-telegram-bot-api";
import { logger } from "./lib/logger";
import { setupBot } from "./bot/index";
import { getDefaultSettings } from "./bot/dbHelper";

let bot: TelegramBot | null = null;

export async function startBot() {
  const token = process.env["TELEGRAM_BOT_TOKEN"];

  if (!token) {
    logger.warn("TELEGRAM_BOT_TOKEN not set, bot will not start");
    return;
  }

  bot = new TelegramBot(token, { polling: true });

  bot.on("polling_error", (err) => {
    logger.error({ err }, "Telegram polling error");
  });

  await getDefaultSettings();
  setupBot(bot);

  logger.info("Telegram bot started successfully");
}

export function getBot() {
  return bot;
}
