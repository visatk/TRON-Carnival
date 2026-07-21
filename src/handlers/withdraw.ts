// ============================================================
// src/handlers/withdraw.ts — Withdrawal request handler
// ============================================================

import { Bot } from 'grammy';
import type { Env } from '../types';
import { E, formatTRX, formatDate, getSettings, getAdminIds } from '../config';
import { getUser } from '../db/users';
import {
  createWithdrawal,
  getUserWithdrawals,
  hasPendingWithdrawal,
} from '../db/withdrawals';

export function registerWithdrawHandler(bot: Bot, env: Env): void {
  bot.hears(`${E.withdraw} Withdraw`, async ctx => {
    if (!ctx.from) return;

    const [user, settings] = await Promise.all([
      getUser(env.DB, ctx.from.id),
      getSettings(env.DB),
    ]);

    if (!user) { await ctx.reply('Please send /start first.'); return; }

    // ── No wallet set ────────────────────────────────────────
    if (!user.wallet_address) {
      await ctx.reply(
        `${E.warning} <b>Wallet Not Set</b>\n\n` +
          `Please set your TRC-20 wallet address first using the <b>${E.wallet} Wallet</b> button.`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    // ── Below minimum ────────────────────────────────────────
    if (user.balance < settings.min_withdrawal) {
      const recentWithdrawals = await getUserWithdrawals(env.DB, ctx.from.id, 3);

      let historyText = '';
      if (recentWithdrawals.length > 0) {
        historyText =
          `\n\n${E.list} <b>Recent Withdrawals:</b>\n` +
          recentWithdrawals
            .map(
              w =>
                `• ${formatTRX(w.amount)} — <i>${w.status}</i> (${formatDate(w.created_at)})` +
                (w.tx_hash ? `\n  📎 <code>${w.tx_hash}</code>` : ''),
            )
            .join('\n');
      }

      await ctx.reply(
        `${E.cross} Minimum withdrawal amount is <b>${formatTRX(settings.min_withdrawal)}</b>.\n` +
          `${E.money} Your balance: <b>${formatTRX(user.balance)}</b>` +
          historyText,
        { parse_mode: 'HTML' },
      );
      return;
    }

    // ── Duplicate pending check ───────────────────────────────
    //
    // Prevents a user from submitting multiple withdrawal requests before
    // the first one is processed by an admin. The balance is deducted when
    // the withdrawal is created, so without this guard a user could drain
    // their balance to 0 and then attempt to submit another request that
    // would pass the balance check on a cached/stale value.
    const alreadyPending = await hasPendingWithdrawal(env.DB, ctx.from.id);
    if (alreadyPending) {
      await ctx.reply(
        `${E.timer} <b>Pending Request Exists</b>\n\n` +
          `You already have a pending withdrawal. Please wait for it to be processed before submitting a new one.\n\n` +
          `Use the <b>${E.stats} Statistics</b> button to check your withdrawal history.`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    // ── Process withdrawal ───────────────────────────────────
    const amount = user.balance; // capture before deduction
    const withdrawalId = await createWithdrawal(
      env.DB,
      ctx.from.id,
      amount,
      user.wallet_address,
    );

    await ctx.reply(
      `${E.check} <b>Withdrawal Request Submitted!</b>\n\n` +
        `${E.money} Amount: <b>${formatTRX(amount)}</b>\n` +
        `${E.wallet} To: <code>${user.wallet_address}</code>\n` +
        `${E.timer} Status: <b>Pending</b>\n\n` +
        `Your withdrawal will be processed within 24 hours. ID: #${withdrawalId}`,
      { parse_mode: 'HTML' },
    );

    // ── Notify admins ────────────────────────────────────────
    const adminIds = getAdminIds(env.ADMIN_IDS);
    const adminText =
      `${E.bell} <b>New Withdrawal Request</b>\n\n` +
      `${E.user} User: <a href="tg://user?id=${ctx.from.id}">${ctx.from.first_name}</a> (ID: <code>${ctx.from.id}</code>)\n` +
      `${E.money} Amount: <b>${formatTRX(amount)}</b>\n` +
      `${E.wallet} Wallet: <code>${user.wallet_address}</code>\n` +
      `${E.tag} Request ID: #${withdrawalId}\n\n` +
      `Use /approve_${withdrawalId} or /reject_${withdrawalId} to process.`;

    await Promise.allSettled(
      adminIds.map(id =>
        bot.api.sendMessage(id, adminText, { parse_mode: 'HTML' }),
      ),
    );
  });
}
