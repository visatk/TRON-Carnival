// ============================================================
// src/index.ts — Cloudflare Worker entry point
// TRX Gifts Airdrop Bot
// ============================================================

import { timingSafeEqual } from 'node:crypto';
import { Bot, webhookCallback } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import type { Env, BroadcastMessage } from './types';
import { E, MAIN_MENU_MARKUP } from './config';

// Handlers
import { registerStartHandler } from './handlers/start';
import { registerTasksHandler } from './handlers/tasks';
import { registerReferralsHandler } from './handlers/referrals';
import { registerWalletHandler, handleWalletInput } from './handlers/wallet';
import { registerWithdrawHandler } from './handlers/withdraw';
import { registerStatsHandler } from './handlers/stats';
import { registerAdminHandlers } from './handlers/admin';

// Queue consumer
import { handleQueue } from './queue';

// DB helpers (for state-based text routing)
import { getUser } from './db/users';

// ── Bot factory ───────────────────────────────────────────────
//
// A new Bot instance is created per request — correct for stateless Workers.
// Do NOT hoist the Bot to module scope: that would share state across isolates
// and can cause floating-promise or stale-context bugs.

function createBot(env: Env): Bot {
  const bot = new Bot(env.BOT_TOKEN);
  
  // Use autoRetry plugin to automatically handle 429 Rate Limits from Telegram
  bot.api.config.use(autoRetry());

  // ── Register all handlers ──────────────────────────────────

  registerStartHandler(bot, env);
  registerTasksHandler(bot, env);
  registerReferralsHandler(bot, env);
  registerWalletHandler(bot, env);
  registerWithdrawHandler(bot, env);
  registerStatsHandler(bot, env);
  registerAdminHandlers(bot, env);

  // ── Global text handler (state-based routing) ──────────────
  //
  // Registered LAST so named hears() above take priority.
  // Handles multi-step flows like wallet address input.

  bot.on('message:text', async ctx => {
    if (!ctx.from || !ctx.message.text) return;

    const user = await getUser(env.DB, ctx.from.id);

    // Not registered yet
    if (!user) {
      await ctx.reply(
        `${E.rocket} Welcome! Send /start to begin earning TRX.`,
        { reply_markup: { remove_keyboard: true } },
      );
      return;
    }

    // State-based routing
    if (user.state === 'awaiting_wallet') {
      await handleWalletInput(
        {
          from: ctx.from,
          message: ctx.message,
          reply: ctx.reply.bind(ctx),
        },
        env,
      );
      return;
    }

    // Default fallback — show menu
    await ctx.reply(
      `${E.rocket} <b>Task Hub</b>\n${E.money} Complete tasks & stack rewards!`,
      { parse_mode: 'HTML', reply_markup: MAIN_MENU_MARKUP },
    );
  });

  // ── Global error handler ───────────────────────────────────

  bot.catch(err => {
    const ctx = err.ctx;
    console.error(`Update ${ctx.update.update_id} failed:`, err.error);
  });

  return bot;
}

// ── Webhook secret validation ─────────────────────────────────
//
// Uses a constant-time comparison (timingSafeEqual from node:crypto) to
// prevent timing-based oracle attacks on the secret token.

function validateWebhookSecret(request: Request, secret: string): boolean {
  const incoming = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
  const encoder = new TextEncoder();
  const incomingBytes = encoder.encode(incoming);
  const expectedBytes = encoder.encode(secret);
  if (incomingBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(incomingBytes, expectedBytes);
}

// ── Worker exports ────────────────────────────────────────────

export default {
  // ── HTTP fetch handler (Telegram webhook) ──────────────────
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // ── /setup — register webhook with Telegram ─────────────
    //
    // Also registers the webhook secret token when WEBHOOK_SECRET is set.
    // Secure it by requiring the secret in the query string: /setup?secret=...
    if (url.pathname === '/setup') {
      if (env.WEBHOOK_SECRET && url.searchParams.get('secret') !== env.WEBHOOK_SECRET) {
        return new Response('Unauthorized - Invalid secret parameter', { status: 401 });
      }

      const webhookUrl = `https://${url.hostname}/webhook`;
      const body: Record<string, unknown> = {
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query'],
      };
      if (env.WEBHOOK_SECRET) {
        body.secret_token = env.WEBHOOK_SECRET;
      }
      const res = await fetch(
        `https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── /webhook — receive Telegram updates ─────────────────
    if (url.pathname === '/webhook' && request.method === 'POST') {
      // Validate webhook secret when configured
      if (env.WEBHOOK_SECRET && !validateWebhookSecret(request, env.WEBHOOK_SECRET)) {
        return new Response('Unauthorized', { status: 401 });
      }

      const bot = createBot(env);
      // The 'cloudflare-mod' adapter handles ctx.waitUntil internally.
      // We set a timeout to prevent the worker from hanging if Telegram is slow.
      const handleUpdate = webhookCallback(bot, 'cloudflare-mod', { timeoutMilliseconds: 10000 });
      
      try {
        return await handleUpdate(request);
      } catch (err) {
        console.error('Error handling update:', err);
        // Return 200 to prevent Telegram from infinitely retrying a failing update
        return new Response('OK', { status: 200 });
      }
    }

    // ── Health check ────────────────────────────────────────
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    return new Response('TRX Gifts Bot — Running', { status: 200 });
  },

  // ── Queue consumer (broadcasts) ────────────────────────────
  //
  // Receives messages produced by the /broadcast admin command.
  // The queue is configured with max_batch_size=50, max_batch_timeout=5s.
  async queue(
    batch: MessageBatch<BroadcastMessage>,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    await handleQueue(batch, env);
  },
} satisfies ExportedHandler<Env>;
