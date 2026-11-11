import { nextAvailableTask } from '../../../shared/progress';
import { TASKS, TASK_BY_ID } from '../../../shared/tasks';
import { evaluatePhoto, parseStoredDeductions } from '../_ai';
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

interface WifeTaskBody {
  taskId?: string;
}

interface PrizeBody {
  image?: string;
}

function getWifeId(env: Ctx['env']): number | null {
  const raw = env.USER_TELEGRAM_ID?.trim();
  const telegramId = raw ? Number(raw) : NaN;
  return raw && Number.isFinite(telegramId) && telegramId > 0 ? telegramId : null;
}

const MAX_PRIZE_BASE64 = 1_500_000;
const PRIZE_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/;

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

/** Прогресс второго пользователя — чтобы владелец видел его в dev-панели. */
async function wifeState(ctx: Ctx): Promise<Response> {
  const telegramId = getWifeId(ctx.env);
  if (!telegramId) {
    return json({
      completed: [],
      manualCompleted: [],
      chestOpened: false,
      configured: false,
    });
  }

  const state = await loadState(ctx.env, telegramId);
  return json({ ...state, configured: true });
}

/** Детали задания жены: дата выполнения, фото и комментарий ИИ. */
async function wifeTask(ctx: Ctx): Promise<Response> {
  const body = await readJson<WifeTaskBody>(ctx.request);
  const task = body?.taskId ? TASK_BY_ID.get(body.taskId) : undefined;
  if (!task) return json({ error: 'task_not_found' }, 404);

  const telegramId = getWifeId(ctx.env);
  if (!telegramId) return json({ error: 'wife_not_configured' }, 400);

  const completion = await ctx.env.DB.prepare(
    `SELECT manual, created_at
     FROM completions
     WHERE telegram_id = ? AND task_id = ?`,
  )
    .bind(telegramId, task.id)
    .first<{ manual: number; created_at: string }>();

  if (!completion) {
    return json({ completed: false, manual: false, createdAt: null, photo: null });
  }

  const photo = await ctx.env.DB.prepare(
    `SELECT mime, image, score, verdict, reason, confidence, deductions, created_at
     FROM photos
     WHERE telegram_id = ? AND task_id = ?
     ORDER BY created_at DESC, rowid DESC
     LIMIT 1`,
  )
    .bind(telegramId, task.id)
    .first<{
      mime: string;
      image: string;
      score: number;
      verdict: string;
      reason: string;
      confidence: number;
      deductions: string;
      created_at: string;
    }>();

  return json({
    completed: true,
    manual: completion.manual === 1,
    createdAt: completion.created_at,
    photo: photo
      ? {
          image: `data:${photo.mime};base64,${photo.image}`,
          score: photo.score,
          verdict: photo.verdict,
          reason: photo.reason,
          deductions: parseStoredDeductions(photo.deductions),
          confidence: photo.confidence,
          createdAt: photo.created_at,
        }
      : null,
  });
}

/** Один раз пересчитывает оценку сохранённого фото жены по актуальным правилам. */
async function recheckWifeTask(ctx: Ctx): Promise<Response> {
  const body = await readJson<WifeTaskBody>(ctx.request);
  const task = body?.taskId ? TASK_BY_ID.get(body.taskId) : undefined;
  if (!task) return json({ error: 'task_not_found' }, 404);

  const telegramId = getWifeId(ctx.env);
  if (!telegramId) return json({ error: 'wife_not_configured' }, 400);

  const completion = await ctx.env.DB.prepare(
    'SELECT 1 AS done FROM completions WHERE telegram_id = ? AND task_id = ?',
  )
    .bind(telegramId, task.id)
    .first<{ done: number }>();
  if (!completion) return json({ error: 'task_not_completed' }, 404);

  const photo = await ctx.env.DB.prepare(
    `SELECT id, mime, image, score, verdict, reason, deductions
     FROM photos
     WHERE telegram_id = ? AND task_id = ?
     ORDER BY created_at DESC, rowid DESC
     LIMIT 1`,
  )
    .bind(telegramId, task.id)
    .first<{
      id: string;
      mime: string;
      image: string;
      score: number;
      verdict: string;
      reason: string;
      deductions: string;
    }>();
  if (!photo) return json({ error: 'photo_not_found' }, 404);

  try {
    // Переоценка — это свежий взгляд по новым правилам, без привязки к старому
    // баллу: иначе модель просто повторяет прежнюю оценку.
    const verdict = await evaluatePhoto(ctx.env, task, `data:${photo.mime};base64,${photo.image}`);

    await ctx.env.DB.prepare(
      `UPDATE photos
       SET score = ?, verdict = ?, reason = ?, confidence = ?, deductions = ?
       WHERE id = ?`,
    )
      .bind(
        verdict.score,
        verdict.verdict,
        verdict.reason,
        verdict.confidence,
        JSON.stringify(verdict.deductions ?? []),
        photo.id,
      )
      .run();

    return json({
      taskId: task.id,
      title: task.title,
      oldScore: photo.score,
      newScore: verdict.score,
      oldVerdict: photo.verdict,
      verdict: verdict.verdict,
      reason: verdict.reason,
      deductions: verdict.deductions ?? [],
      improved: verdict.score > photo.score,
    });
  } catch {
    return json({ error: 'ai_unavailable' }, 502);
  }
}

async function reset(ctx: Ctx, telegramId: number): Promise<Response> {
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('DELETE FROM completions WHERE telegram_id = ?').bind(telegramId),
    ctx.env.DB.prepare('DELETE FROM photos WHERE telegram_id = ?').bind(telegramId),
    ctx.env.DB.prepare('DELETE FROM app_state WHERE telegram_id = ?').bind(telegramId),
  ]);
  return json({ completed: [], manualCompleted: [], chestOpened: false, isOwner: true });
}

/** Загрузка чувствительного QR-приза. Доступна только владельцу. */
async function savePrize(ctx: Ctx): Promise<Response> {
  const body = await readJson<PrizeBody>(ctx.request);
  const match = typeof body?.image === 'string' ? PRIZE_RE.exec(body.image) : null;
  if (!match) return json({ error: 'invalid_image' }, 400);

  const base64 = match[2].replace(/\s/g, '');
  if (base64.length > MAX_PRIZE_BASE64) return json({ error: 'image_too_large' }, 413);

  await ctx.env.DB.prepare(
    `INSERT INTO prizes (id, mime, image, updated_at)
     VALUES ('main', ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       mime = excluded.mime,
       image = excluded.image,
       updated_at = datetime('now')`,
  )
    .bind(match[1], base64)
    .run();

  return json({ ok: true });
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
      case 'wife':
        return await wifeState(ctx);
      case 'wife-task':
        return await wifeTask(ctx);
      case 'recheck-wife-task':
        return await recheckWifeTask(ctx);
      case 'prize':
        return await savePrize(ctx);
      default:
        return json({ error: 'unknown_action' }, 404);
    }
  } catch {
    return json({ error: 'db_unavailable' }, 500);
  }
};
