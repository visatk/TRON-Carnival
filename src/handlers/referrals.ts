// ============================================================
// src/handlers/referrals.ts — Referrals panel handler
// ============================================================

import { Bot } from 'grammy';
import type { Env } from '../types';
import { E, buildReferralLink, formatTRX, getSettings } from '../config';
import { getUser } from '../db/users';
import { getReferralCount, getReferralEarnings } from '../db/referrals';

export function registerReferralsHandler(bot: Bot, env: Env): void {
  bot.hears(`${E.users} Referrals`, async ctx => {
    if (!ctx.from) return;

    const [user, settings, count, earnings, me] = await Promise.all([
      getUser(env.DB, ctx.from.id),
      getSettings(env.DB),
      getReferralCount(env.DB, ctx.from.id),
      getReferralEarnings(env.DB, ctx.from.id),
      ctx.api.getMe(),
    ]);

    if (!user) {
      await ctx.reply(`Please send /start first.`);
      return;
    }

    const referralLink = buildReferralLink(me.username!, ctx.from.id);

    const text =
      `${E.users} <b>Your Referral Dashboard</b>\n\n` +
      `${E.chart} <b>Per Referral:</b> ${formatTRX(settings.referral_reward)}\n` +
      `${E.trophy} <b>Total Referrals:</b> ${count}\n` +
      `${E.money} <b>Total Earned:</b> ${formatTRX(earnings)}\n\n` +
      `${E.link} <b>Your Referral Link:</b>\n` +
      `<code>${referralLink}</code>\n\n` +
      `${E.fire} Share your link and earn <b>${formatTRX(settings.referral_reward)}</b> for every friend who joins!\n\n` +
      `<i>Tap the link above to copy it.</i>`;

    await ctx.reply(text, { parse_mode: 'HTML' });
  });
}
