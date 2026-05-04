import TelegramBot from "node-telegram-bot-api";

export const PREMIUM_EMOJI = {
  star: { id: "5458797798495377338", fallback: "⭐" },
  diamond: { id: "5199552030615558774", fallback: "💎" },
  crown: { id: "5224607267797606837", fallback: "👑" },
};

export function pe(key: keyof typeof PREMIUM_EMOJI): string {
  const e = PREMIUM_EMOJI[key];
  return `<tg-emoji emoji-id="${e.id}">${e.fallback}</tg-emoji>`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function safeSend(
  bot: TelegramBot,
  chatId: number,
  text: string,
  options?: TelegramBot.SendMessageOptions
): Promise<boolean> {
  try {
    await bot.sendMessage(chatId, text, {
      parse_mode: "HTML",
      ...options,
    });
    return true;
  } catch {
    return false;
  }
}

export async function broadcastMessage(
  bot: TelegramBot,
  userIds: number[],
  text: string,
  options?: TelegramBot.SendMessageOptions
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  for (const userId of userIds) {
    try {
      await bot.sendMessage(userId, text, {
        parse_mode: "HTML",
        ...options,
      });
      success++;
    } catch (err: unknown) {
      const telegramErr = err as {
        code?: string;
        response?: { body?: { error_code?: number; parameters?: { retry_after?: number } } };
      };
      if (telegramErr?.response?.body?.error_code === 429) {
        const retryAfter =
          telegramErr.response?.body?.parameters?.retry_after ?? 5;
        await sleep(retryAfter * 1000);
        try {
          await bot.sendMessage(userId, text, {
            parse_mode: "HTML",
            ...options,
          });
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
