import { computeStatuses } from '../../../../shared/progress';
import { TASK_BY_ID } from '../../../../shared/tasks';
import {
  authenticate,
  json,
  loadState,
  readJson,
  timingSafeEqual,
  type Ctx,
} from '../../_shared';

interface ManualBody {
  pin?: string;
}

export const onRequestPost = async ({ request, env, params }: Ctx): Promise<Response> => {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;

  if (!env.MANUAL_PIN) return json({ error: 'server_not_configured' }, 500);

  const task = TASK_BY_ID.get(params.id);
  if (!task) return json({ error: 'task_not_found' }, 404);

  const body = await readJson<ManualBody>(request);
  const pin = typeof body?.pin === 'string' ? body.pin.trim() : '';
  if (!pin) return json({ error: 'invalid_pin' }, 400);
  if (!timingSafeEqual(pin, env.MANUAL_PIN)) {
    return json({ error: 'invalid_pin' }, 403);
  }

  try {
    const state = await loadState(env, auth.user.id);
    if (state.completed.includes(task.id)) {
      return json({ error: 'already_completed', ...state }, 409);
    }

    const statuses = computeStatuses(state.completed);
    if (statuses.get(task.id) !== 'available') {
      return json({ error: 'task_locked' }, 409);
    }

    await env.DB.prepare(
      `INSERT OR IGNORE INTO completions
         (telegram_id, task_id, points, manual)
       VALUES (?, ?, ?, 1)`,
    )
      .bind(auth.user.id, task.id, task.points)
      .run();

    return json({
      ...(await loadState(env, auth.user.id)),
      isOwner: auth.isOwner,
      points: task.points,
    });
  } catch {
    return json({ error: 'db_unavailable' }, 500);
  }
};
