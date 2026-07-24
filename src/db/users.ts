// ============================================================
// src/db/users.ts — User database operations
// ============================================================

import type { DbUser, UserState } from '../types';

// ── Read ─────────────────────────────────────────────────────

export async function getUser(
  db: D1Database,
  id: number,
): Promise<DbUser | null> {
  return db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(id)
    .first<DbUser>();
}

export async function getTotalUserCount(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) as cnt FROM users')
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

// ── Upsert ───────────────────────────────────────────────────

/**
 * Gets an existing user or creates a new one.
 * Always keeps username + first_name fresh on each /start.
 */
export async function getOrCreateUser(
  db: D1Database,
  tgUser: { id: number; username?: string; first_name: string },
  referredBy?: number,
): Promise<DbUser> {
  const existing = await getUser(db, tgUser.id);

  if (existing) {
    // Refresh display name so it's always up-to-date
    await db
      .prepare('UPDATE users SET username = ?, first_name = ? WHERE id = ?')
      .bind(tgUser.username ?? null, tgUser.first_name, tgUser.id)
      .run();
    return { ...existing, username: tgUser.username ?? null, first_name: tgUser.first_name };
  }

  await db
    .prepare(
      'INSERT INTO users (id, username, first_name, referred_by) VALUES (?, ?, ?, ?)',
    )
    .bind(tgUser.id, tgUser.username ?? null, tgUser.first_name, referredBy ?? null)
    .run();

  return (await getUser(db, tgUser.id))!;
}

// ── Balance ──────────────────────────────────────────────────

export async function addBalance(
  db: D1Database,
  userId: number,
  amount: number,
): Promise<void> {
  await db
    .prepare('UPDATE users SET balance = balance + ? WHERE id = ?')
    .bind(amount, userId)
    .run();
}

export async function deductBalance(
  db: D1Database,
  userId: number,
  amount: number,
): Promise<boolean> {
  const user = await getUser(db, userId);
  if (!user || user.balance < amount) return false;

  await db
    .prepare('UPDATE users SET balance = balance - ? WHERE id = ?')
    .bind(amount, userId)
    .run();
  return true;
}

// ── Join bonus ────────────────────────────────────────────────

/**
 * Claims the join bonus atomically — marks the flag and credits balance
 * in a single D1 batch so both succeed or fail together.
 * Idempotent: returns false if the bonus was already claimed.
 */
export async function claimJoinBonus(
  db: D1Database,
  userId: number,
  amount: number,
): Promise<boolean> {
  // Conditional update: only runs when join_bonus_claimed = 0.
  // meta.changes will be 0 if the bonus was already claimed.
  const result = await db
    .prepare(
      'UPDATE users SET join_bonus_claimed = 1, balance = balance + ? WHERE id = ? AND join_bonus_claimed = 0',
    )
    .bind(amount, userId)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

// ── Wallet ────────────────────────────────────────────────────

export async function setWalletAddress(
  db: D1Database,
  userId: number,
  address: string,
): Promise<void> {
  await db
    .prepare('UPDATE users SET wallet_address = ?, state = NULL WHERE id = ?')
    .bind(address, userId)
    .run();
}

// ── State (multi-step flows) ──────────────────────────────────

export async function setState(
  db: D1Database,
  userId: number,
  state: UserState,
): Promise<void> {
  await db
    .prepare('UPDATE users SET state = ? WHERE id = ?')
    .bind(state, userId)
    .run();
}

// ── Bulk (for broadcasts) ─────────────────────────────────────

/**
 * Returns user IDs in ascending order with cursor-based pagination (keyset).
 *
 * D1 limits query results to 10,000 rows. For broadcasts, callers must
 * loop with increasing lastId until fewer than `limit` rows are returned.
 *
 * @param limit  Max rows per page (default 100 for Queues limits)
 * @param lastId The last ID seen from the previous page, or 0 for the first page
 */
export async function getAllUserIds(
  db: D1Database,
  limit = 100,
  lastId = 0,
): Promise<number[]> {
  const { results } = await db
    .prepare('SELECT id FROM users WHERE id > ? ORDER BY id ASC LIMIT ?')
    .bind(lastId, limit)
    .all<{ id: number }>();
  return results.map(r => r.id);
}
