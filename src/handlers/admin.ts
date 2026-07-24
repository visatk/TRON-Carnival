// ============================================================
// src/handlers/admin.ts — Admin-only command handlers
// ============================================================

import { Bot, Context, InlineKeyboard } from 'grammy';
import type { Env, BroadcastMessage } from '../types';
import {
  E,
  formatTRX,
  formatDate,
  getSettings,
  setSetting,
  isAdmin,
  getAdminIds,
} from '../config';
import { createTask, deleteTask, toggleTask, getAllTasks } from '../db/tasks';
import {
  getPendingWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
  getWithdrawal,
} from '../db/withdrawals';
import { getUser, getAllUserIds } from '../db/users';

// ── Queue sendBatch limit ──────────────────────────────────────
// Cloudflare Queues supports up to 100 messages per sendBatch call.
const QUEUE_BATCH_SIZE = 100;

export function registerAdminHandlers(bot: Bot, env: Env): void {
  // ── Guard: all admin commands require admin check ──────────
  //
  // Typed as Context (not any) so TypeScript checks that ctx.reply
  // exists and all property accesses are valid.

  const adminGuard = async (ctx: Context): Promise<boolean> => {
    if (!ctx.from || !isAdmin(ctx.from.id, env.ADMIN_IDS)) {
      await ctx.reply(`${E.cross} You are not authorized to use this command.`);
      return false;
    }
    return true;
  };

  // ── /myid — utility to reveal your Telegram user ID ───────

  bot.command('myid', async ctx => {
    await ctx.reply(
      `${E.user} <b>Your Telegram ID:</b> <code>${ctx.from?.id}</code>`,
      { parse_mode: 'HTML' },
    );
  });

  // ── /admin — admin dashboard ───────────────────────────────

  bot.command('admin', async ctx => {
    if (!(await adminGuard(ctx))) return;

    const [settings, tasks, pending] = await Promise.all([
      getSettings(env.DB),
      getAllTasks(env.DB),
      getPendingWithdrawals(env.DB),
    ]);

    const text =
      `${E.admin} <b>Admin Dashboard</b>\n\n` +
      `<b>⚙️ Settings</b>\n` +
      `• Welcome Bonus: ${formatTRX(settings.welcome_bonus)}\n` +
      `• Referral Reward: ${formatTRX(settings.referral_reward)}\n` +
      `• Min Withdrawal: ${formatTRX(settings.min_withdrawal)}\n` +
      `• Required Channels: ${settings.required_channels.length > 0 ? settings.required_channels.join(', ') : 'None'}\n\n` +
      `<b>📋 Tasks</b>: ${tasks.length} total (${tasks.filter(t => t.is_active).length} active)\n` +
      `<b>💸 Pending Withdrawals</b>: ${pending.length}\n\n` +
      `<b>Commands:</b>\n` +
      `/addtask – Add a task\n` +
      `/tasks_list – View all tasks\n` +
      `/withdrawals – View pending withdrawals\n` +
      `/setbonus &lt;amount&gt; – Set welcome bonus\n` +
      `/setreferral &lt;amount&gt; – Set referral reward\n` +
      `/setminwithdraw &lt;amount&gt; – Set min withdrawal\n` +
      `/setchannels &lt;@ch1,@ch2&gt; – Set required channels\n` +
      `/broadcast &lt;message&gt; – Broadcast to all users\n` +
      `/myid – Show your Telegram ID`;

    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  // ── /addtask — add a new task ──────────────────────────────
  // Usage: /addtask Title | Description | Reward | Link

  bot.command('addtask', async ctx => {
    if (!(await adminGuard(ctx))) return;

    const args = ctx.match?.trim();
    if (!args) {
      await ctx.reply(
        `${E.pencil} <b>Usage:</b>\n` +
          `/addtask &lt;title&gt; | &lt;description&gt; | &lt;reward&gt; | &lt;link&gt;\n\n` +
          `<b>Example:</b>\n` +
          `/addtask Join our channel | Join @MyChannel and stay | 0.5 | https://t.me/MyChannel`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    const parts = args.split('|').map(s => s.trim());
    if (parts.length < 4) {
      await ctx.reply(`${E.cross} Please provide all 4 fields separated by |`);
      return;
    }

    const [title, description, rewardStr, link] = parts;
    const reward = parseFloat(rewardStr);

    if (isNaN(reward) || reward <= 0) {
      await ctx.reply(`${E.cross} Invalid reward amount.`);
      return;
    }
    if (!link.startsWith('http')) {
      await ctx.reply(`${E.cross} Link must start with http:// or https://`);
      return;
    }

    const id = await createTask(env.DB, title, description, reward, link);
    await ctx.reply(
      `${E.check} Task created! ID: <b>${id}</b>\n\n` +
        `${E.tag} <b>${title}</b>\n` +
        `${E.money} Reward: ${formatTRX(reward)}\n` +
        `${E.link} ${link}`,
      { parse_mode: 'HTML' },
    );
  });

  // ── /tasks_list — list all tasks ──────────────────────────

  bot.command('tasks_list', async ctx => {
    if (!(await adminGuard(ctx))) return;

    const tasks = await getAllTasks(env.DB);
    if (tasks.length === 0) {
      await ctx.reply('No tasks yet. Use /addtask to create one.');
      return;
    }

    const text =
      `${E.tasks} <b>All Tasks</b>\n\n` +
      tasks
        .map(
          t =>
            `<b>ID ${t.id}</b> ${t.is_active ? '🟢' : '🔴'} <b>${t.title}</b>\n` +
            `  ${E.money} ${formatTRX(t.reward)} | ${E.link} ${t.link}\n` +
            `  /deltask_${t.id} | /toggletask_${t.id}`,
        )
        .join('\n\n');

    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  // ── /deltask_<id> — delete a task ─────────────────────────

  bot.hears(/^\/deltask_(\d+)$/, async ctx => {
    if (!(await adminGuard(ctx))) return;
    const id = parseInt(ctx.match[1], 10);
    const deleted = await deleteTask(env.DB, id);
    await ctx.reply(
      deleted ? `${E.check} Task #${id} deleted.` : `${E.cross} Task #${id} not found.`,
    );
  });

  // ── /toggletask_<id> — enable/disable a task ──────────────

  bot.hears(/^\/toggletask_(\d+)$/, async ctx => {
    if (!(await adminGuard(ctx))) return;
    const id = parseInt(ctx.match[1], 10);
    const toggled = await toggleTask(env.DB, id);
    await ctx.reply(
      toggled ? `${E.check} Task #${id} toggled.` : `${E.cross} Task #${id} not found.`,
    );
  });

  // ── /withdrawals — list pending withdrawal requests ────────

  bot.command('withdrawals', async ctx => {
    if (!(await adminGuard(ctx))) return;

    const pending = await getPendingWithdrawals(env.DB, 20);
    if (pending.length === 0) {
      await ctx.reply(`${E.check} No pending withdrawals.`);
      return;
    }

    const text =
      `${E.withdraw} <b>Pending Withdrawals (${pending.length})</b>\n\n` +
      pending
        .map(
          w =>
            `<b>#${w.id}</b> — User <code>${w.user_id}</code>\n` +
            `  ${E.money} ${formatTRX(w.amount)}\n` +
            `  ${E.wallet} <code>${w.wallet_address}</code>\n` +
            `  📅 ${formatDate(w.created_at)}\n` +
            `  /approve_${w.id} | /reject_${w.id}`,
        )
        .join('\n\n');

    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  // ── /approve_<id> — approve a withdrawal ──────────────────

  bot.hears(/^\/approve_(\d+)(?:\s+(.+))?$/, async ctx => {
    if (!(await adminGuard(ctx))) return;

    const id = parseInt(ctx.match[1], 10);
    const txHash = ctx.match[2]?.trim() || undefined;

    const withdrawal = await getWithdrawal(env.DB, id);
    if (!withdrawal) {
      await ctx.reply(`${E.cross} Withdrawal #${id} not found.`);
      return;
    }

    const approved = await approveWithdrawal(env.DB, id, txHash);
    if (!approved) {
      await ctx.reply(`${E.cross} Withdrawal #${id} is not pending.`);
      return;
    }

    await ctx.reply(
      `${E.check} Withdrawal #${id} approved!\n` +
        (txHash ? `📎 TX: <code>${txHash}</code>` : ''),
      { parse_mode: 'HTML' },
    );

    // Notify user
    try {
      await bot.api.sendMessage(
        withdrawal.user_id,
        `${E.check} <b>Withdrawal Approved!</b>\n\n` +
          `${E.money} Amount: <b>${formatTRX(withdrawal.amount)}</b>\n` +
          `${E.wallet} To: <code>${withdrawal.wallet_address}</code>\n` +
          (txHash ? `📎 TX Hash: <code>${txHash}</code>` : ''),
        { parse_mode: 'HTML' },
      );
    } catch { /* user may have blocked bot */ }
  });

  // ── /reject_<id> — reject a withdrawal ────────────────────

  bot.hears(/^\/reject_(\d+)$/, async ctx => {
    if (!(await adminGuard(ctx))) return;

    const id = parseInt(ctx.match[1], 10);
    const withdrawal = await rejectWithdrawal(env.DB, id);

    if (!withdrawal) {
      await ctx.reply(`${E.cross} Withdrawal #${id} not found or already processed.`);
      return;
    }

    await ctx.reply(
      `${E.check} Withdrawal #${id} rejected. Balance of ${formatTRX(withdrawal.amount)} refunded to user <code>${withdrawal.user_id}</code>.`,
      { parse_mode: 'HTML' },
    );

    // Notify user
    try {
      await bot.api.sendMessage(
        withdrawal.user_id,
        `${E.cross} <b>Withdrawal Rejected</b>\n\n` +
          `${E.money} Your balance of <b>${formatTRX(withdrawal.amount)}</b> has been refunded.\n` +
          `Please contact support if you believe this is an error.`,
        { parse_mode: 'HTML' },
      );
    } catch { /* user may have blocked bot */ }
  });

  // ── Settings commands ──────────────────────────────────────

  bot.command('setbonus', async ctx => {
    if (!(await adminGuard(ctx))) return;
    const val = parseFloat(ctx.match?.trim() ?? '');
    if (isNaN(val) || val < 0) { await ctx.reply('Usage: /setbonus <amount>'); return; }
    await setSetting(env.DB, 'welcome_bonus', val.toString());
    await ctx.reply(`${E.check} Welcome bonus set to <b>${formatTRX(val)}</b>.`, { parse_mode: 'HTML' });
  });

  bot.command('setreferral', async ctx => {
    if (!(await adminGuard(ctx))) return;
    const val = parseFloat(ctx.match?.trim() ?? '');
    if (isNaN(val) || val < 0) { await ctx.reply('Usage: /setreferral <amount>'); return; }
    await setSetting(env.DB, 'referral_reward', val.toString());
    await ctx.reply(`${E.check} Referral reward set to <b>${formatTRX(val)}</b>.`, { parse_mode: 'HTML' });
  });

  bot.command('setminwithdraw', async ctx => {
    if (!(await adminGuard(ctx))) return;
    const val = parseFloat(ctx.match?.trim() ?? '');
    if (isNaN(val) || val < 0) { await ctx.reply('Usage: /setminwithdraw <amount>'); return; }
    await setSetting(env.DB, 'min_withdrawal', val.toString());
    await ctx.reply(`${E.check} Minimum withdrawal set to <b>${formatTRX(val)}</b>.`, { parse_mode: 'HTML' });
  });

  // Usage: /setchannels @Chan1,@Chan2,-100123456
  bot.command('setchannels', async ctx => {
    if (!(await adminGuard(ctx))) return;
    const raw = ctx.match?.trim() ?? '';
    if (!raw) {
      await ctx.reply(
        `${E.pencil} <b>Usage:</b> /setchannels &lt;@Chan1,@Chan2&gt;\n\nSend empty to clear: /setchannels clear`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    const channels = raw === 'clear' ? [] : raw.split(',').map(c => c.trim()).filter(Boolean);
    await setSetting(env.DB, 'required_channels', JSON.stringify(channels));
    await ctx.reply(
      channels.length === 0
        ? `${E.check} Required channels cleared.`
        : `${E.check} Required channels set:\n${channels.join('\n')}`,
    );
  });

  // ── /broadcast — send message to all users via Queue ──────
  //
  // Uses sendBatch() (up to 100 msgs per call, max 256KB).
  // Fetches user IDs with keyset pagination.

  bot.command('broadcast', async ctx => {
    if (!(await adminGuard(ctx))) return;

    const text = ctx.match?.trim();
    if (!text) {
      await ctx.reply(`${E.pencil} <b>Usage:</b> /broadcast &lt;your message&gt;`, { parse_mode: 'HTML' });
      return;
    }

    let lastId = 0;
    let totalSent = 0;

    while (true) {
      const userIds = await getAllUserIds(env.DB, QUEUE_BATCH_SIZE, lastId);
      if (userIds.length === 0) break;

      await env.QUEUE.sendBatch(
        userIds.map((userId): MessageSendRequest<BroadcastMessage> => ({
          body: { userId, text, parse_mode: 'HTML' },
        })),
      );

      totalSent += userIds.length;
      lastId = userIds[userIds.length - 1]; // Advance the cursor

      if (userIds.length < QUEUE_BATCH_SIZE) break; // last page
    }

    await ctx.reply(
      `${E.check} Broadcast queued for <b>${totalSent}</b> users.\n\n` +
        `Preview:\n${text}`,
      { parse_mode: 'HTML' },
    );
  });
}

