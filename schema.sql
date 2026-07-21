-- ============================================================
-- TRX Gifts Airdrop Bot — D1 Database Schema
-- ============================================================

-- Users registered with the bot
CREATE TABLE IF NOT EXISTS users (
  id                  INTEGER PRIMARY KEY,        -- Telegram user ID
  username            TEXT,
  first_name          TEXT    NOT NULL DEFAULT '',
  referred_by         INTEGER,                    -- referrer's user ID
  balance             REAL    NOT NULL DEFAULT 0,
  join_bonus_claimed  INTEGER NOT NULL DEFAULT 0, -- 0 or 1
  wallet_address      TEXT,                       -- TRC-20 address
  state               TEXT,                       -- multi-step flow: 'awaiting_wallet'
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Admin-managed task list
CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  description TEXT,
  reward      REAL    NOT NULL,
  link        TEXT    NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Prevents users from double-claiming tasks
CREATE TABLE IF NOT EXISTS task_completions (
  user_id      INTEGER NOT NULL,
  task_id      INTEGER NOT NULL,
  completed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, task_id)
);

-- Referral records
CREATE TABLE IF NOT EXISTS referrals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id  INTEGER NOT NULL,
  referred_id  INTEGER NOT NULL,
  reward_amount REAL   NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(referred_id)             -- one referral per user
);

-- Withdrawal requests
CREATE TABLE IF NOT EXISTS withdrawals (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  amount         REAL    NOT NULL,
  wallet_address TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  tx_hash        TEXT,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  processed_at   INTEGER
);

-- Key-value settings (admin-configurable)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Defaults
INSERT OR IGNORE INTO settings VALUES ('welcome_bonus',       '2');
INSERT OR IGNORE INTO settings VALUES ('referral_reward',     '4');
INSERT OR IGNORE INTO settings VALUES ('min_withdrawal',      '14');
INSERT OR IGNORE INTO settings VALUES ('required_channels',   '["@drkingbd", "@CyberCoderBD"]');

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_users_referred_by        ON users(referred_by);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id    ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id      ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status       ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_tasks_is_active          ON tasks(is_active);
CREATE INDEX IF NOT EXISTS idx_task_completions_user_id ON task_completions(user_id);
