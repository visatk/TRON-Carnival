// ============================================================
// src/handlers/start.ts — /start command handler
// ============================================================

import { Bot, Context, InlineKeyboard } from 'grammy';
import type { Env } from '../types';
import {
  E,
  MAIN_MENU_MARKUP,
  buildReferralLink,
  getSettings,
  parseReferralPayload,
} from '../config';
import { getOrCreateUser, claimJoinBonus } from '../db/users';
import { createReferral } from '../db/referrals';
import { getMissingChannels, buildJoinChannelsKeyboard } from '../middleware/membership';

export function registerStartHandler(bot: Bot, env: Env): void {
  // ── /start command ─────────────────────────────────────────

  bot.command('start', async ctx => {
    const tgUser = ctx.from;
    if (!tgUser) return;

    const settings = await getSettings(env.DB);

    // Parse referral payload (e.g. "REF_123456789")
    const referrerId = parseReferralPayload(ctx.match);

    // Register / refresh user
    await getOrCreateUser(
      env.DB,
      { id: tgUser.id, username: tgUser.username, first_name: tgUser.first_name },
      referrerId !== tgUser.id ? referrerId : undefined,
    );

    // ── Check required channel membership ────────────────────

    const missing = await getMissingChannels(bot.api, tgUser.id, settings.required_channels);

    if (missing.length > 0) {
      const channelList = missing
        .map(ch => `${E.tulip} <b>Join</b> ${ch}`)
        .join('\n');

      await ctx.reply(
        `${E.gift} <b>TRX Gift Airdrop Is Live.</b>\n` +
          `${E.gift} <b>${settings.welcome_bonus} TRX (${(settings.welcome_bonus * 0.4).toFixed(2)}$) Welcome Bonus</b>\n` +
          `${E.users} <b>${settings.referral_reward} TRX (${(settings.referral_reward * 0.4).toFixed(2)}$) per Successful Referral!</b>\n\n` +
          `${E.globe} <b>Steps to Claim Your Rewards</b>\n\n` +
          channelList +
          `\n\n${E.wallet} Tap "Continue" below to proceed`,
        {
          parse_mode: 'HTML',
          reply_markup: buildJoinChannelsKeyboard(missing),
        },
      );
      return;
    }

    // ── All channels joined — show welcome & send main menu ──

    await sendWelcome(ctx, env, tgUser.id, settings.welcome_bonus, settings.referral_reward, referrerId);
  });

  // ── ✅ Continue callback (after joining channels) ──────────

  bot.callbackQuery('verify_membership', async ctx => {
    const tgUser = ctx.from;
    if (!tgUser) return;

    const settings = await getSettings(env.DB);
    const missing = await getMissingChannels(ctx.api, tgUser.id, settings.required_channels);

    if (missing.length > 0) {
      await ctx.answerCallbackQuery({
        text: `${E.cross} You still need to join all required channels!`,
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery({ text: `${E.check} Verified!` });

    // Delete the join-gate message
    try { await ctx.deleteMessage(); } catch { /* ignore */ }

    const user = await getOrCreateUser(env.DB, {
      id: tgUser.id,
      username: tgUser.username,
      first_name: tgUser.first_name,
    });

    await sendWelcome(ctx, env, tgUser.id, settings.welcome_bonus, settings.referral_reward, user.referred_by ?? undefined);
  });
}

// ── Shared welcome logic ──────────────────────────────────────

async function sendWelcome(
  ctx: Context,
  env: Env,
  userId: number,
  welcomeBonus: number,
  referralReward: number,
  referrerId?: number,
): Promise<void> {
  const tgUser = ctx.from!;

  // Credit join bonus (idempotent — only once)
  const bonusCredited = await claimJoinBonus(env.DB, userId, welcomeBonus);

  // Credit referrer
  if (referrerId && bonusCredited) {
    await createReferral(env.DB, referrerId, userId, referralReward);
    // Notify referrer
    try {
      await ctx.api.sendMessage(
        referrerId,
        `${E.users} <b>New Referral!</b>\n\n` +
          `${tgUser.first_name} joined via your link.\n` +
          `${E.money} You earned <b>${referralReward} TRX</b>!`,
        { parse_mode: 'HTML' },
      );
    } catch { /* referrer may have blocked the bot */ }
  }

  // Get bot username for referral link
  const me = await ctx.api.getMe();

  const bonusLine = bonusCredited
    ? `\n${E.check} <b>Welcome bonus of ${welcomeBonus} TRX has been credited to your account!</b>`
    : '';

  await ctx.reply(
    `${E.rocket} <b>Task Hub</b>\n\n` +
      `${E.money} Complete tasks & stack rewards!${bonusLine}\n\n` +
      `${E.users} Your referral link:\n` +
      `<code>${buildReferralLink(me.username!, userId)}</code>`,
    {
      parse_mode: 'HTML',
      reply_markup: MAIN_MENU_MARKUP,
    },
  );
}
