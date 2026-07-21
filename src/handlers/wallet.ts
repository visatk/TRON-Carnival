// ============================================================
// src/handlers/wallet.ts — Wallet management handler
// ============================================================

import { Bot } from 'grammy';
import type { Context } from 'grammy';
import type { Env } from '../types';
import { E, validateTRC20Address, MAIN_MENU_MARKUP } from '../config';
import { getUser, setWalletAddress, setState } from '../db/users';

// ── Register the 💎 Wallet button handler ──────────────────────

export function registerWalletHandler(bot: Bot, env: Env): void {
  bot.hears(`${E.wallet} Wallet`, async ctx => {
    if (!ctx.from) return;

    const user = await getUser(env.DB, ctx.from.id);
    if (!user) {
      await ctx.reply('Please send /start first.');
      return;
    }

    if (user.wallet_address) {
      await ctx.reply(
        `${E.wallet} <b>Your Wallet</b>\n\n` +
          `<b>TRC-20 Address:</b>\n<code>${user.wallet_address}</code>\n\n` +
          `To update your wallet, send a new TRC-20 address:`,
        { parse_mode: 'HTML' },
      );
    } else {
      await ctx.reply(
        `${E.wallet} <b>Set Your Wallet Address</b>\n\n` +
          `Please send your <b>TRC-20 (TRON)</b> wallet address.\n\n` +
          `${E.warning} The address must start with <b>T</b> and be exactly <b>34 characters</b>.`,
        { parse_mode: 'HTML' },
      );
    }

    // Put user into awaiting_wallet state so the global text handler routes here
    await setState(env.DB, ctx.from.id, 'awaiting_wallet');
  });
}

// ── State-based input handler (called from index.ts global text router) ───────
//
// This is intentionally a free function, not a bot handler, so that index.ts
// can call it after checking user.state === 'awaiting_wallet'.

export interface WalletInputCtx {
  from: NonNullable<Context['from']>;
  message: { text: string };
  reply: Context['reply'];
}

export async function handleWalletInput(
  ctx: WalletInputCtx,
  env: Env,
): Promise<void> {
  const address = ctx.message.text.trim();

  if (!validateTRC20Address(address)) {
    await ctx.reply(
      `${E.cross} <b>Invalid TRC-20 Address</b>\n\n` +
        `The address must:\n` +
        `• Start with <b>T</b>\n` +
        `• Be exactly <b>34 characters</b> long\n` +
        `• Use Base58 characters only (no 0, O, I, l)\n\n` +
        `Please send a valid address:`,
      { parse_mode: 'HTML' },
    );
    return; // keep state as awaiting_wallet — user must try again
  }

  await setWalletAddress(env.DB, ctx.from.id, address);
  // setWalletAddress also clears state to NULL (see db/users.ts)

  await ctx.reply(
    `${E.check} <b>Wallet Address Saved!</b>\n\n` +
      `${E.wallet} <code>${address}</code>\n\n` +
      `You can now withdraw using the <b>${E.withdraw} Withdraw</b> button.`,
    { parse_mode: 'HTML', reply_markup: MAIN_MENU_MARKUP },
  );
}