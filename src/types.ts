// ============================================================
// src/types.ts — Domain types for the TRX Gifts Bot
// ============================================================

/** Cloudflare Worker environment bindings */
export interface Env {
  DB: D1Database;
  QUEUE: Queue<BroadcastMessage>;
  /** Telegram Bot Token — set via: wrangler secret put BOT_TOKEN */
  BOT_TOKEN: string;
  /** Comma-separated admin Telegram user IDs — set via: wrangler secret put ADMIN_IDS */
  ADMIN_IDS: string;
  /**
   * Optional webhook secret — set via: wrangler secret put WEBHOOK_SECRET
   * If set, every incoming webhook request must carry the matching
   * X-Telegram-Bot-Api-Secret-Token header (set during /setup).
   */
  WEBHOOK_SECRET?: string;
}

// ── User state machine ────────────────────────────────────────

/** All valid multi-step conversation states for a user row */
export type UserState = 'awaiting_wallet' | null;

// ── Queue message types ──────────────────────────────────────

export interface BroadcastMessage {
  /** Telegram user ID to deliver the message to */
  userId: number;
  text: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
}

// ── Database row types ───────────────────────────────────────

export interface DbUser {
  id: number;
  username: string | null;
  first_name: string;
  referred_by: number | null;
  balance: number;
  join_bonus_claimed: number; // 0 or 1
  wallet_address: string | null;
  state: UserState;
  created_at: number;
}

export interface DbTask {
  id: number;
  title: string;
  description: string | null;
  reward: number;
  link: string;
  is_active: number; // 0 or 1
  created_at: number;
}

export interface DbTaskCompletion {
  user_id: number;
  task_id: number;
  completed_at: number;
}

export interface DbReferral {
  id: number;
  referrer_id: number;
  referred_id: number;
  reward_amount: number;
  created_at: number;
}

export interface DbWithdrawal {
  id: number;
  user_id: number;
  amount: number;
  wallet_address: string;
  status: 'pending' | 'approved' | 'rejected';
  tx_hash: string | null;
  created_at: number;
  processed_at: number | null;
}

export interface DbSetting {
  key: string;
  value: string;
}

// ── App-level types ──────────────────────────────────────────

export interface Settings {
  welcome_bonus: number;
  referral_reward: number;
  min_withdrawal: number;
  required_channels: string[]; // e.g. ['@ChannelOne', '-100123456']
}

export interface UserStats {
  balance: number;
  total_referrals: number;
  join_bonus: number;
  referral_earnings: number;
  withdrawals_made: number;
}
