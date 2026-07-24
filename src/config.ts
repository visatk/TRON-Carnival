// ============================================================
// src/config.ts — Configuration helpers and text templates
// ============================================================

import type { Settings } from './types';

// ── Emoji constants ──────────────────────────────────────────

export const E = {
  gift:     '🎁',
  money:    '💰',
  users:    '👥',
  wallet:   '💎',
  withdraw: '💸',
  stats:    '📊',
  tasks:    '📋',
  check:    '✅',
  cross:    '❌',
  rocket:   '🚀',
  tulip:    '🌷',
  link:     '🔗',
  chart:    '📈',
  coin:     '🪙',
  fire:     '🔥',
  bell:     '🔔',
  warning:  '⚠️',
  trophy:   '🏆',
  timer:    '⏳',
  admin:    '🛡',
  tag:      '🏷',
  pencil:   '✏️',
  trash:    '🗑',
  list:     '📝',
  user:     '👤',
  arrow:    '➡️',
  globe:    '🌐',
} as const;

// ── Settings loader ──────────────────────────────────────────

export async function getSettings(db: D1Database): Promise<Settings> {
  const { results } = await db
    .prepare('SELECT key, value FROM settings')
    .all<{ key: string; value: string }>();

  const map = new Map(results.map(r => [r.key, r.value]));

  // Safely parse required_channels — fall back to [] if value is missing or malformed
  let required_channels: string[] = [];
  const rawChannels = map.get('required_channels');
  if (rawChannels) {
    try {
      const parsed = JSON.parse(rawChannels);
      required_channels = Array.isArray(parsed) ? parsed : [];
    } catch {
      console.error('Failed to parse required_channels setting, defaulting to []');
    }
  }

  return {
    welcome_bonus:     parseFloat(map.get('welcome_bonus')   ?? '2'),
    referral_reward:   parseFloat(map.get('referral_reward') ?? '4'),
    min_withdrawal:    parseFloat(map.get('min_withdrawal')  ?? '14'),
    required_channels,
  };
}

export async function setSetting(
  db: D1Database,
  key: string,
  value: string,
): Promise<void> {
  await db
    .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .bind(key, value)
    .run();
}

// ── Admin helpers ────────────────────────────────────────────

export function getAdminIds(adminIdsEnv: string): number[] {
  if (!adminIdsEnv) return [];
  return adminIdsEnv
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n));
}

export function isAdmin(userId: number, adminIdsEnv: string): boolean {
  return getAdminIds(adminIdsEnv).includes(userId);
}

// ── Formatters ───────────────────────────────────────────────

export function formatTRX(amount: number): string {
  // Show whole numbers cleanly, decimals with up to 8 places trimmed
  if (amount === Math.floor(amount)) return `${amount} TRX`;
  return `${parseFloat(amount.toFixed(8))} TRX`;
}

export function formatDate(unixTs: number): string {
  return new Date(unixTs * 1000).toISOString().slice(0, 10);
}

// ── Validators ───────────────────────────────────────────────

/**
 * Validates a TRC-20 (TRON) address.
 * Must start with 'T' and be exactly 34 base58 characters.
 */
export function validateTRC20Address(address: string): boolean {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
}

// ── Referral helpers ─────────────────────────────────────────

export function buildReferralLink(botUsername: string, userId: number): string {
  return `https://t.me/${botUsername}?start=REF_${userId}`;
}

export function parseReferralPayload(payload: string | undefined): number | undefined {
  if (!payload?.startsWith('REF_')) return undefined;
  const id = parseInt(payload.slice(4), 10);
  return isNaN(id) ? undefined : id;
}

// ── Main reply keyboard layout ───────────────────────────────

export const MAIN_MENU_MARKUP = {
  keyboard: [
    [
      { text: `${E.tasks} Tasks` },
      { text: `${E.users} Referrals` },
    ],
    [
      { text: `${E.wallet} Wallet` },
      { text: `${E.withdraw} Withdraw` },
    ],
    [
      { text: `${E.stats} Statistics` },
    ],
  ],
  resize_keyboard: true,
  persistent: true,
} as const;
