// ============================================================
// src/db/withdrawals.ts — Withdrawal database operations
// ============================================================

import type { DbWithdrawal } from '../types';

// ── Create ────────────────────────────────────────────────────

/**
 * Creates a withdrawal request and deducts the amount from the user's
 * balance atomically via D1 batch.
 *
 * Previously two separate statements — if the worker crashed between them
 * the user would be debited without a withdrawal record. D1 batch ensures
 * both succeed or both fail.
 *
 * Returns the new withdrawal's row ID.
 */
export async function createWithdrawal(
  db: D1Database,
  userId: number,
  amount: number,
  walletAddress: string,
): Promise<number> {
  const insertStmt = db
    .prepare(
      'INSERT INTO withdrawals (user_id, amount, wallet_address) VALUES (?, ?, ?)',
    )
    .bind(userId, amount, walletAddress);

  const deductStmt = db
    .prepare('UPDATE users SET balance = balance - ? WHERE id = ?')
    .bind(amount, userId);

  const [insertResult] = await db.batch([insertStmt, deductStmt]);
  return insertResult.meta.last_row_id as number;
}

// ── Read ─────────────────────────────────────────────────────

export async function getPendingWithdrawals(
  db: D1Database,
  limit = 20,
): Promise<DbWithdrawal[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM withdrawals WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?",
    )
    .bind(limit)
    .all<DbWithdrawal>();
  return results;
}

export async function getWithdrawal(
  db: D1Database,
  id: number,
): Promise<DbWithdrawal | null> {
  return db
    .prepare('SELECT * FROM withdrawals WHERE id = ?')
    .bind(id)
    .first<DbWithdrawal>();
}

export async function getUserWithdrawals(
  db: D1Database,
  userId: number,
  limit = 5,
): Promise<DbWithdrawal[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .bind(userId, limit)
    .all<DbWithdrawal>();
  return results;
}

export async function getWithdrawalCount(
  db: D1Database,
  userId: number,
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) as cnt FROM withdrawals WHERE user_id = ? AND status = 'approved'",
    )
    .bind(userId)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

/**
 * Returns true if the user already has a pending withdrawal request.
 * Used to prevent duplicate submissions before the admin processes the
 * first one.
 */
export async function hasPendingWithdrawal(
  db: D1Database,
  userId: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT 1 FROM withdrawals WHERE user_id = ? AND status = 'pending' LIMIT 1",
    )
    .bind(userId)
    .first<{ 1: number }>();
  return row !== null;
}

// ── Admin mutations ───────────────────────────────────────────

export async function approveWithdrawal(
  db: D1Database,
  id: number,
  txHash?: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE withdrawals SET status = 'approved', tx_hash = ?, processed_at = unixepoch() WHERE id = ? AND status = 'pending'",
    )
    .bind(txHash ?? null, id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * Rejects a pending withdrawal and refunds the user atomically via D1 batch.
 *
 * Previously two separate statements — a crash between them would leave
 * the withdrawal rejected but the user's balance unreturned.
 * D1 batch ensures both the status update and the refund succeed together.
 *
 * Returns the withdrawal record on success, or null if not found / not pending.
 */
export async function rejectWithdrawal(
  db: D1Database,
  id: number,
): Promise<DbWithdrawal | null> {
  // Fetch the withdrawal first to validate it's pending and to get the amount
  const withdrawal = await getWithdrawal(db, id);
  if (!withdrawal || withdrawal.status !== 'pending') return null;

  const rejectStmt = db
    .prepare(
      "UPDATE withdrawals SET status = 'rejected', processed_at = unixepoch() WHERE id = ?",
    )
    .bind(id);

  const refundStmt = db
    .prepare('UPDATE users SET balance = balance + ? WHERE id = ?')
    .bind(withdrawal.amount, withdrawal.user_id);

  // Atomic: both the status update and refund run together
  await db.batch([rejectStmt, refundStmt]);

  return withdrawal;
}
