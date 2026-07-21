// ============================================================
// src/queue.ts — Cloudflare Queue consumer (broadcast messages)
// ============================================================

import type { BroadcastMessage } from './types';
import type { Env } from './types';

/**
 * Processes broadcast messages from the Cloudflare Queue.
 * Sends each message to the target user via the Telegram Bot API.
 *
 * Queue config: max_batch_size=50, max_batch_timeout=5s, max_retries=5.
 *
 * Ack/Retry strategy:
 *   - 403 (user blocked bot): ack — no point retrying, message undeliverable.
 *   - 429 (rate limited): retry with Retry-After delay from Telegram's response.
 *   - Network error: retry (transient failure, Worker may have lost connectivity).
 *   - All others: ack with error log — prevents dead-letter pileup on Telegram bugs.
 *
 * Note: grammY's Bot instance is NOT used here to avoid the overhead of
 * constructing a full Bot (with all handlers) just to send one message.
 * Raw Telegram Bot API calls are sufficient for this fan-out use case.
 */
export async function handleQueue(
  batch: MessageBatch<BroadcastMessage>,
  env: Env,
): Promise<void> {
  const TELEGRAM_API = `https://api.telegram.org/bot${env.BOT_TOKEN}`;

  await Promise.allSettled(
    batch.messages.map(async msg => {
      const { userId, text, parse_mode } = msg.body;

      try {
        const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: userId,
            text,
            parse_mode: parse_mode ?? 'HTML',
          }),
        });

        if (!res.ok) {
          type TelegramErrorResponse = {
            description?: string;
            parameters?: { retry_after?: number };
          };
          const err = await res.json() as TelegramErrorResponse;

          // 403 = user blocked bot — ack and move on (no point retrying)
          if (res.status === 403) {
            console.warn(`Broadcast to ${userId}: user blocked bot. Acking.`);
            msg.ack();
            return;
          }

          // 429 = Telegram rate limit — retry after the specified delay
          if (res.status === 429) {
            const retryAfter = err.parameters?.retry_after ?? 5;
            console.warn(`Broadcast to ${userId}: rate limited, retrying in ${retryAfter}s.`);
            msg.retry({ delaySeconds: retryAfter });
            return;
          }

          // All other non-OK responses: log and ack to prevent infinite retries
          // on persistent Telegram-side errors (e.g., chat_not_found, user_deactivated).
          console.error(`Broadcast to ${userId} failed (${res.status}): ${err.description}`);
          msg.ack();
          return;
        }

        msg.ack();
      } catch (err) {
        // Network/fetch error — transient, safe to retry
        console.error(`Broadcast fetch error for ${userId}:`, err);
        msg.retry();
      }
    }),
  );
}
