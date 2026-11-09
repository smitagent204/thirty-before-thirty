import { TOTAL_POINTS } from '../../../shared/levels';
import { computePoints } from '../../../shared/progress';
import { authenticate, json, loadState, type Ctx } from '../_shared';

export const onRequestPost = async ({ request, env }: Ctx): Promise<Response> => {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;

  try {
    const state = await loadState(env, auth.user.id);
    if (state.chestOpened) {
      return json({ ...state, isOwner: auth.isOwner });
    }

    const points = computePoints(state.completed);
    if (points < TOTAL_POINTS) {
      return json({ error: 'chest_locked', points }, 409);
    }

    await env.DB.prepare(
      `INSERT INTO app_state (telegram_id, chest_opened, updated_at)
       VALUES (?, 1, datetime('now'))
       ON CONFLICT(telegram_id) DO UPDATE SET
         chest_opened = 1,
         updated_at = datetime('now')`,
    )
      .bind(auth.user.id)
      .run();

    return json({ ...state, chestOpened: true, isOwner: auth.isOwner });
  } catch {
    return json({ error: 'db_unavailable' }, 500);
  }
};
