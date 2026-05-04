import TelegramBot from "node-telegram-bot-api";
import { logger } from "../lib/logger";

export const PREMIUM_EMOJI = {
  star: { id: "5458797798495377338", fallback: "⭐" },
  diamond: { id: "5199552030615558774", fallback: "💎" },
  crown: { id: "5224607267797606837", fallback: "👑" },
};

export function pe(key: keyof typeof PREMIUM_EMOJI): string {
  return PREMIUM_EMOJI[key].fallback;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let _bot: TelegramBot | null = null;

export function setBotInstance(bot: TelegramBot) {
  _bot = bot;
}

export async function safeSend(
  chatId: number,
  text: string,
  options?: TelegramBot.SendMessageOptions
): Promise<boolean> {
  if (!_bot) {
    logger.error("safeSend: _bot not initialized");
    return false;
  }
  try {
    await _bot.sendMessage(chatId, text, {
      parse_mode: "HTML",
      ...options,
    });
    return true;
  } catch (err) {
    logger.warn({ err, chatId }, "safeSend HTML failed, retrying plain");
    try {
      await _bot.sendMessage(chatId, text.replace(/<[^>]+>/g, ""), options);
      return true;
    } catch (err2) {
      logger.error({ err: err2, chatId }, "safeSend failed completely");
      return false;
    }
  }
}

export async function broadcastMessage(
  bot: TelegramBot,
  userIds: number[],
  text: string,
  entities?: TelegramBot.MessageEntity[],
  options?: TelegramBot.SendMessageOptions
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  const sendOpts: TelegramBot.SendMessageOptions = entities && entities.length > 0
    ? { entities, ...options }
    : { parse_mode: "HTML", ...options };

  for (const userId of userIds) {
    try {
      await bot.sendMessage(userId, text, sendOpts);
      success++;
    } catch (err: unknown) {
      const telegramErr = err as {
        response?: { body?: { error_code?: number; parameters?: { retry_after?: number } } };
      };
      if (telegramErr?.response?.body?.error_code === 429) {
        const retryAfter = telegramErr.response?.body?.parameters?.retry_after ?? 5;
        await sleep(retryAfter * 1000);
        try {
          await bot.sendMessage(userId, text, sendOpts);
          success++;
          await sleep(50);
          continue;
        } catch {
          failed++;
        }
      } else {
        failed++;
      }
    }
    await sleep(50);
  }

  return { success, failed };
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString("fa-IR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
