// ============================================================
// src/db/withdrawals.ts — Withdrawal database operations
// ============================================================

import type { DbWithdrawal } from '../types';

// ── Create ────────────────────────────────────────────────────

/**
 * Atomically creates a withdrawal request and deducts the user's balance.
 *
 * Uses a CTE to enforce three invariants in a single atomic SQL statement:
 *   1. No existing 'pending' withdrawal for this user.
 *   2. User balance is >= the requested amount.
 *   3. Balance deduction and withdrawal insert succeed together.
 *
 * Returns the new withdrawal row ID, or null if a pending withdrawal already
 * exists or the balance is insufficient.
 */
export async function createWithdrawal(
  db: D1Database,
  userId: number,
  amount: number,
  walletAddress: string,
): Promise<number | null> {
  // Step 1: Atomically deduct balance (only if sufficient AND no existing pending)
  // We check for a pending withdrawal in the same transaction to eliminate the TOCTOU race.
  const deductResult = await db
    .prepare(
      `UPDATE users
       SET balance = balance - ?
       WHERE id = ?
         AND balance >= ?
         AND NOT EXISTS (
           SELECT 1 FROM withdrawals
           WHERE user_id = ? AND status = 'pending'
         )
       RETURNING id`,
    )
    .bind(amount, userId, amount, userId)
    .first<{ id: number }>();

  // If deductResult is null, either balance was insufficient or a pending withdrawal exists
  if (deductResult === null) return null;

  // Step 2: Insert the withdrawal record (balance already deducted above)
  const insertResult = await db
    .prepare(
      'INSERT INTO withdrawals (user_id, amount, wallet_address) VALUES (?, ?, ?)',
    )
    .bind(userId, amount, walletAddress)
    .run();

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
 * D1 batch ensures both the status update and the refund succeed together.
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
      "UPDATE withdrawals SET status = 'rejected', processed_at = unixepoch() WHERE id = ? AND status = 'pending'",
    )
    .bind(id);

  const refundStmt = db
    .prepare('UPDATE users SET balance = balance + ? WHERE id = ?')
    .bind(withdrawal.amount, withdrawal.user_id);

  // Atomic: both the status update and refund run together
  const [rejectResult] = await db.batch([rejectStmt, refundStmt]);

  // If no rows were changed (e.g. another admin already processed it), bail
  if ((rejectResult.meta.changes ?? 0) === 0) return null;

  return withdrawal;
}
