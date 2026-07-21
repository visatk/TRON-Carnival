// ============================================================
// src/handlers/stats.ts — Statistics panel handler
// ============================================================

import { Bot } from 'grammy';
import type { Env } from '../types';
import { E, formatTRX, getSettings } from '../config';
import { getUser, getTotalUserCount } from '../db/users';
import { getReferralCount, getReferralEarnings } from '../db/referrals';
import { getWithdrawalCount } from '../db/withdrawals';

export function registerStatsHandler(bot: Bot, env: Env): void {
  bot.hears(`${E.stats} Statistics`, async ctx => {
    if (!ctx.from) return;

    const [user, settings, referralCount, referralEarnings, withdrawalCount, totalUsers] =
      await Promise.all([
        getUser(env.DB, ctx.from.id),
        getSettings(env.DB),
        getReferralCount(env.DB, ctx.from.id),
        getReferralEarnings(env.DB, ctx.from.id),
        getWithdrawalCount(env.DB, ctx.from.id),
        getTotalUserCount(env.DB),
      ]);

    if (!user) { await ctx.reply('Please send /start first.'); return; }

    const joinBonus = user.join_bonus_claimed ? settings.welcome_bonus : 0;

    const text =
      `${E.stats} <b>Your Statistics</b>\n\n` +
      `${E.money} <b>Current Balance:</b> ${formatTRX(user.balance)}\n` +
      `${E.users} <b>Total Referrals:</b> ${referralCount}\n` +
      `${E.gift} <b>Joining Bonus:</b> ${formatTRX(joinBonus)}\n` +
      `${E.chart} <b>Referral Earnings:</b> ${formatTRX(referralEarnings)}\n` +
      `${E.withdraw} <b>Withdrawals Made:</b> ${withdrawalCount}\n\n` +
      `${E.chart} <b>Per Referral:</b> ${formatTRX(settings.referral_reward)}\n` +
      `${E.user} <b>Bot Users:</b> ${totalUsers}`;

    await ctx.reply(text, { parse_mode: 'HTML' });
  });
}
