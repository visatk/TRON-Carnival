// ============================================================
// src/queue.ts — Cloudflare Queue consumer (broadcast messages)
// ============================================================

import type { BroadcastMessage, Env } from './types';

/**
 * Processes broadcast messages from the Cloudflare Queue.
 * Sends each message to the target user via the Telegram Bot API.
 *
 * Queue config: max_batch_size=50, max_batch_timeout=5s, max_retries=5.
 *
 * Ack/Retry strategy:
 *   - 403 (user blocked bot): ack — permanent, no point retrying.
 *   - 400 (chat not found / user deactivated): ack — permanent failure.
 *   - 429 (rate limited): retry with Retry-After delay from Telegram response.
 *   - 5xx (Telegram server errors): retry with 10s backoff.
 *   - Network error: retry with 10s backoff.
 *   - All others: ack with error log — prevents dead-letter pileup.
 *
 * Note: grammY's Bot instance is NOT used here to avoid constructing a full
 * Bot (with all handlers registered) just to send one message. Raw Telegram
 * Bot API calls are sufficient and much lighter for this fan-out use case.
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

          // 403 = user blocked bot — permanent failure, ack and move on
          if (res.status === 403) {
            console.warn(`Broadcast to ${userId}: user blocked bot. Acking.`);
            msg.ack();
            return;
          }

          // 400 = bad request (user deactivated, chat not found) — permanent failure
          if (res.status === 400) {
            console.warn(`Broadcast to ${userId} permanently failed (400): ${err.description}`);
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

          // 5xx = Telegram server errors — transient, retry with backoff
          if (res.status >= 500) {
            console.warn(`Broadcast to ${userId}: Telegram server error (${res.status}), retrying in 10s.`);
            msg.retry({ delaySeconds: 10 });
            return;
          }

          // All other non-OK responses: log and ack to prevent infinite loops
          console.error(`Broadcast to ${userId} failed (${res.status}): ${err.description}`);
          msg.ack();
          return;
        }

        msg.ack();
      } catch (err) {
        // Network/fetch error — transient, retry with backoff
        console.error(`Broadcast fetch error for ${userId}:`, err);
        msg.retry({ delaySeconds: 10 });
      }
    }),
  );
}
