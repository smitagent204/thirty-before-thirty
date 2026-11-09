import { nextAvailableTask } from '../../../shared/progress';
import { TASKS, TASK_BY_ID } from '../../../shared/tasks';
import {
  authenticate,
  json,
  loadState,
  readJson,
  type Ctx,
} from '../_shared';

interface ToggleBody {
  taskId?: string;
}

async function completeAll(ctx: Ctx, telegramId: number): Promise<Response> {
  const statements = TASKS.map((task) =>
    ctx.env.DB.prepare(
      `INSERT OR IGNORE INTO completions
         (telegram_id, task_id, points, manual)
       VALUES (?, ?, ?, 0)`,
    ).bind(telegramId, task.id, task.points),
  );
  await ctx.env.DB.batch(statements);
  return json({ ...(await loadState(ctx.env, telegramId)), isOwner: true });
}

async function completeNext(ctx: Ctx, telegramId: number): Promise<Response> {
  const state = await loadState(ctx.env, telegramId);
  const next = nextAvailableTask(state.completed);
  if (!next) return json({ ...state, isOwner: true });
  await ctx.env.DB.prepare(
    `INSERT OR IGNORE INTO completions
       (telegram_id, task_id, points, manual)
     VALUES (?, ?, ?, 0)`,
  )
    .bind(telegramId, next.id, next.points)
    .run();
  return json({ ...(await loadState(ctx.env, telegramId)), isOwner: true });
}

async function toggle(ctx: Ctx, telegramId: number): Promise<Response> {
  const body = await readJson<ToggleBody>(ctx.request);
  const task = body?.taskId ? TASK_BY_ID.get(body.taskId) : undefined;
  if (!task) return json({ error: 'task_not_found' }, 404);

  const state = await loadState(ctx.env, telegramId);
  if (state.completed.includes(task.id)) {
    await ctx.env.DB.prepare(
      'DELETE FROM completions WHERE telegram_id = ? AND task_id = ?',
    )
      .bind(telegramId, task.id)
      .run();
  } else {
    await ctx.env.DB.prepare(
      `INSERT OR IGNORE INTO completions
         (telegram_id, task_id, points, manual)
       VALUES (?, ?, ?, 0)`,
    )
      .bind(telegramId, task.id, task.points)
      .run();
  }
  return json({ ...(await loadState(ctx.env, telegramId)), isOwner: true });
}

async function reset(ctx: Ctx, telegramId: number): Promise<Response> {
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('DELETE FROM completions WHERE telegram_id = ?').bind(telegramId),
    ctx.env.DB.prepare('DELETE FROM photos WHERE telegram_id = ?').bind(telegramId),
    ctx.env.DB.prepare('DELETE FROM app_state WHERE telegram_id = ?').bind(telegramId),
  ]);
  return json({ completed: [], manualCompleted: [], chestOpened: false, isOwner: true });
}

export const onRequestPost = async (ctx: Ctx): Promise<Response> => {
  const auth = await authenticate(ctx.request, ctx.env);
  if (auth instanceof Response) return auth;
  if (!auth.isOwner) return json({ error: 'forbidden' }, 403);

  try {
    switch (ctx.params.action) {
      case 'complete-all':
        return await completeAll(ctx, auth.user.id);
      case 'complete-next':
        return await completeNext(ctx, auth.user.id);
      case 'toggle':
        return await toggle(ctx, auth.user.id);
      case 'reset':
        return await reset(ctx, auth.user.id);
      default:
        return json({ error: 'unknown_action' }, 404);
    }
  } catch {
    return json({ error: 'db_unavailable' }, 500);
  }
};
