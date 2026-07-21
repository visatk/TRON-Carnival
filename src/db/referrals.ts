// ============================================================
// src/db/referrals.ts — Referral database operations
// ============================================================

import type { DbReferral } from '../types';

// ── Create ────────────────────────────────────────────────────

/**
 * Records a referral and credits the referrer atomically using a SQLite CTE.
 *
 * ## Why a CTE instead of db.batch([INSERT OR IGNORE, UPDATE])?
 *
 * D1's db.batch() executes all statements in a single transaction, BUT
 * `INSERT OR IGNORE` silences constraint violations without throwing.
 * This means if the INSERT is skipped (duplicate referred_id), the batch
 * does NOT roll back — the UPDATE still runs and double-credits the referrer.
 *
 * The CTE approach is fully atomic in a single statement:
 *   1. The INSERT attempts to add the referral row.
 *   2. The UPDATE on balance only executes if the CTE (newly_referral)
 *      returned at least one row — i.e., the INSERT actually happened.
 *   3. A single RETURNING clause lets us know whether the credit occurred.
 *
 * Returns true if a new referral was created and reward was credited.
 * Returns false if the referral already existed (unique constraint) or
 * if referrerId === referredId (self-referral guard).
 */
export async function createReferral(
  db: D1Database,
  referrerId: number,
  referredId: number,
  rewardAmount: number,
): Promise<boolean> {
  // Guard: don't self-refer
  if (referrerId === referredId) return false;

  const result = await db
    .prepare(
      `WITH newly_referred AS (
         INSERT OR IGNORE INTO referrals (referrer_id, referred_id, reward_amount)
         VALUES (?, ?, ?)
         RETURNING 1
       )
       UPDATE users
       SET balance = balance + ?
       WHERE id = ? AND EXISTS (SELECT 1 FROM newly_referred)
       RETURNING id`,
    )
    .bind(referrerId, referredId, rewardAmount, rewardAmount, referrerId)
    .first<{ id: number }>();

  // result is non-null only when the UPDATE actually executed (i.e., INSERT succeeded)
  return result !== null;
}

// ── Read ─────────────────────────────────────────────────────

export async function getReferralCount(
  db: D1Database,
  referrerId: number,
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) as cnt FROM referrals WHERE referrer_id = ?')
    .bind(referrerId)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

export async function getReferralEarnings(
  db: D1Database,
  referrerId: number,
): Promise<number> {
  const row = await db
    .prepare(
      'SELECT COALESCE(SUM(reward_amount), 0) as total FROM referrals WHERE referrer_id = ?',
    )
    .bind(referrerId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function getReferrals(
  db: D1Database,
  referrerId: number,
  limit = 10,
): Promise<DbReferral[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM referrals WHERE referrer_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .bind(referrerId, limit)
    .all<DbReferral>();
  return results;
}
