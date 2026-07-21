// ============================================================
// src/db/tasks.ts — Task database operations
// ============================================================

import type { DbTask } from '../types';

// ── Read ─────────────────────────────────────────────────────

export async function getAllTasks(db: D1Database): Promise<DbTask[]> {
  const { results } = await db
    .prepare('SELECT * FROM tasks ORDER BY created_at DESC')
    .all<DbTask>();
  return results;
}

export async function getActiveTasks(db: D1Database): Promise<DbTask[]> {
  const { results } = await db
    .prepare('SELECT * FROM tasks WHERE is_active = 1 ORDER BY created_at DESC')
    .all<DbTask>();
  return results;
}

export async function getTask(
  db: D1Database,
  id: number,
): Promise<DbTask | null> {
  return db
    .prepare('SELECT * FROM tasks WHERE id = ?')
    .bind(id)
    .first<DbTask>();
}

// ── Completions ───────────────────────────────────────────────

export async function getCompletedTaskIds(
  db: D1Database,
  userId: number,
): Promise<Set<number>> {
  const { results } = await db
    .prepare('SELECT task_id FROM task_completions WHERE user_id = ?')
    .bind(userId)
    .all<{ task_id: number }>();
  return new Set(results.map(r => r.task_id));
}

/**
 * Marks a task as complete and credits the reward atomically using a SQLite CTE.
 *
 * ## Why a CTE instead of db.batch([INSERT OR IGNORE, UPDATE])?
 *
 * D1's db.batch() runs all statements in one transaction, BUT `INSERT OR IGNORE`
 * silences the unique-constraint violation without aborting the batch.
 * If the user already claimed the task, the INSERT is skipped (0 rows written)
 * but the subsequent UPDATE on users.balance still executes — double-crediting.
 *
 * The CTE approach is a single, fully-atomic SQL statement:
 *   1. INSERT OR IGNORE attempts to record the completion.
 *   2. The UPDATE credits balance ONLY if the CTE returned a row
 *      (i.e., the INSERT actually happened — not ignored).
 *   3. RETURNING id lets us detect whether the credit occurred.
 *
 * Returns true if the task was newly claimed and reward was credited.
 * Returns false if the task was already claimed (unique constraint fired).
 */
export async function claimTask(
  db: D1Database,
  userId: number,
  taskId: number,
  reward: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `WITH newly_claimed AS (
         INSERT OR IGNORE INTO task_completions (user_id, task_id)
         VALUES (?, ?)
         RETURNING 1
       )
       UPDATE users
       SET balance = balance + ?
       WHERE id = ? AND EXISTS (SELECT 1 FROM newly_claimed)
       RETURNING id`,
    )
    .bind(userId, taskId, reward, userId)
    .first<{ id: number }>();

  // result is non-null only when the UPDATE actually ran (INSERT was new)
  return result !== null;
}

// ── Admin mutations ───────────────────────────────────────────

export async function createTask(
  db: D1Database,
  title: string,
  description: string,
  reward: number,
  link: string,
): Promise<number> {
  const result = await db
    .prepare(
      'INSERT INTO tasks (title, description, reward, link) VALUES (?, ?, ?, ?)',
    )
    .bind(title, description, reward, link)
    .run();
  return result.meta.last_row_id as number;
}

export async function deleteTask(db: D1Database, id: number): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM tasks WHERE id = ?')
    .bind(id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function toggleTask(
  db: D1Database,
  id: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      'UPDATE tasks SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?',
    )
    .bind(id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
