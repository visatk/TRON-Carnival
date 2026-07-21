// ============================================================
// src/handlers/tasks.ts — Tasks panel handler
// ============================================================

import { Bot, Context, InlineKeyboard } from 'grammy';
import type { Env, DbTask } from '../types';
import { E, formatTRX } from '../config';
import { getActiveTasks, getTask, claimTask, getCompletedTaskIds } from '../db/tasks';

export function registerTasksHandler(bot: Bot, env: Env): void {
  // ── 📋 Tasks button ────────────────────────────────────────

  bot.hears(`${E.tasks} Tasks`, async ctx => {
    if (!ctx.from) return;
    await showTaskList(ctx, env);
  });

  // ── Individual task detail (callback) ─────────────────────

  bot.callbackQuery(/^task_view_(\d+)$/, async ctx => {
    if (!ctx.from) return;

    const taskId = parseInt(ctx.match[1], 10);

    // Fetch task data and the user's completed set in parallel
    const [task, completedIds] = await Promise.all([
      getTask(env.DB, taskId),
      getCompletedTaskIds(env.DB, ctx.from.id),
    ]);

    if (!task || !task.is_active) {
      await ctx.answerCallbackQuery({ text: 'Task not found.', show_alert: true });
      return;
    }

    const isDone = completedIds.has(taskId);

    const kb = new InlineKeyboard();
    if (!isDone) {
      kb.url(`${E.link} Open Task Link`, task.link).row();
      kb.text(`${E.check} Claim Reward`, `task_claim_${task.id}`).row();
    }
    kb.text(`${E.arrow} Back to Tasks`, 'tasks_list');

    await ctx.editMessageText(
      buildTaskDetailText(task, isDone),
      {
        parse_mode: 'HTML',
        reply_markup: kb,
      },
    );
    await ctx.answerCallbackQuery();
  });

  // ── Claim task reward ──────────────────────────────────────

  bot.callbackQuery(/^task_claim_(\d+)$/, async ctx => {
    if (!ctx.from) return;

    const taskId = parseInt(ctx.match[1], 10);
    const task = await getTask(env.DB, taskId);

    if (!task || !task.is_active) {
      await ctx.answerCallbackQuery({ text: 'Task no longer available.', show_alert: true });
      return;
    }

    const credited = await claimTask(env.DB, ctx.from.id, taskId, task.reward);

    if (!credited) {
      await ctx.answerCallbackQuery({
        text: `${E.cross} You already claimed this task!`,
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery({
      text: `${E.check} Reward of ${formatTRX(task.reward)} credited!`,
      show_alert: true,
    });

    // Refresh the task detail view — now shows as completed
    const kb = new InlineKeyboard().text(`${E.arrow} Back to Tasks`, 'tasks_list');
    await ctx.editMessageText(buildTaskDetailText(task, true), {
      parse_mode: 'HTML',
      reply_markup: kb,
    });
  });

  // ── Back to task list (callback) ──────────────────────────

  bot.callbackQuery('tasks_list', async ctx => {
    if (!ctx.from) return;
    const [tasks, completedIds] = await Promise.all([
      getActiveTasks(env.DB),
      getCompletedTaskIds(env.DB, ctx.from.id),
    ]);

    const { text, kb } = buildTaskListMessage(tasks, completedIds);
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
  });
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Sends the task list as a new message.
 * Accepts the full grammY Context so we can use ctx.reply() safely.
 */
async function showTaskList(ctx: Context, env: Env): Promise<void> {
  if (!ctx.from) return;
  const [tasks, completedIds] = await Promise.all([
    getActiveTasks(env.DB),
    getCompletedTaskIds(env.DB, ctx.from.id),
  ]);

  const { text, kb } = buildTaskListMessage(tasks, completedIds);
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

function buildTaskListMessage(
  tasks: DbTask[],
  completedIds: Set<number>,
): { text: string; kb: InlineKeyboard } {
  if (tasks.length === 0) {
    return {
      text: `${E.tasks} <b>Available Tasks</b>\n\nNo tasks available right now. Check back soon!`,
      kb: new InlineKeyboard(),
    };
  }

  let text = `${E.tasks} <b>Available Tasks</b>\n\n`;

  const kb = new InlineKeyboard();
  let i = 1;
  for (const task of tasks) {
    const done = completedIds.has(task.id);
    const icon = done ? E.check : E.timer;
    text += `${i}. ${icon} ${task.title}\n   ${E.money} Reward: <b>${formatTRX(task.reward)}</b>\n\n`;
    kb.text(
      `${done ? '✅' : '🗓'} ${task.title}`,
      `task_view_${task.id}`,
    ).row();
    i++;
  }

  return { text, kb };
}

function buildTaskDetailText(task: DbTask, isDone: boolean): string {
  return (
    `${E.tasks} <b>${task.title}</b>\n\n` +
    (task.description ? `${E.pencil} <b>Description:</b> ${task.description}\n` : '') +
    `${E.money} <b>Reward:</b> ${formatTRX(task.reward)}\n` +
    `${E.link} <b>Link:</b> <a href="${task.link}">${task.link}</a>\n\n` +
    (isDone
      ? `${E.check} <b>Task completed! Reward has been credited.</b>`
      : `After completing the task, tap <b>Claim Reward</b> below:`)
  );
}
