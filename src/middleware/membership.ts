// ============================================================
// src/middleware/membership.ts — Telegram channel membership check
// ============================================================

import type { Api } from 'grammy';

/**
 * Checks whether a Telegram user is a member of all required channels.
 *
 * Status mapping (per Telegram Bot API getChatMember):
 *   creator       → full member ✅
 *   administrator → full member ✅
 *   member        → full member ✅
 *   restricted    → still in group but limited rights ❌ (treated as not joined)
 *   left          → not a member ❌
 *   kicked        → banned ❌
 *
 * @param api      grammY Api instance (pass `ctx.api` or `bot.api`, NOT the Bot object)
 * @param userId   Telegram user ID to check
 * @param channels Array of channel usernames (e.g. '@ChannelName') or numeric IDs ('-100...')
 * @returns        Array of channel identifiers the user has NOT fully joined yet
 */
export async function getMissingChannels(
  api: Api,
  userId: number,
  channels: string[],
): Promise<string[]> {
  if (channels.length === 0) return [];

  const results = await Promise.allSettled(
    channels.map(channel =>
      api.getChatMember(channel, userId).then(member => ({
        channel,
        status: member.status,
      })),
    ),
  );

  const missing: string[] = [];
  for (const result of results) {
    if (result.status === 'rejected') {
      // Channel doesn't exist or bot isn't an admin — skip silently.
      // Do NOT block the user: if we can't check, we assume they're allowed.
      continue;
    }
    const { channel, status } = result.value;
    // Only 'member', 'administrator', and 'creator' are considered fully joined.
    // 'restricted' users are still in the chat but may have limited permissions;
    // we treat them as not having properly joined to prevent abuse.
    const isFullMember = status === 'member' || status === 'administrator' || status === 'creator';
    if (!isFullMember) {
      missing.push(channel);
    }
  }

  return missing;
}

/**
 * Builds an inline keyboard with "Join" buttons for channels the user
 * still needs to join, plus a "✅ Continue" verify button.
 */
export function buildJoinChannelsKeyboard(channels: string[]): {
  inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>>;
} {
  const rows = channels.map(ch => {
    // Build the public join URL:
    //   @Username  → https://t.me/Username
    //   -100xxxxx  → https://t.me/c/xxxxx   (private supergroup)
    const url = ch.startsWith('@')
      ? `https://t.me/${ch.slice(1)}`
      : `https://t.me/c/${ch.replace(/^-100/, '')}/1`;
    return [{ text: `🌷 Join ${ch}`, url }];
  });

  // Verify button — triggers re-check of membership
  rows.push([{ text: '✅ Continue', callback_data: 'verify_membership' }]);

  return { inline_keyboard: rows };
}
