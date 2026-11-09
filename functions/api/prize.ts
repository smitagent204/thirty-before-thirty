import { authenticate, json, type Ctx } from './_shared';

/**
 * Выдаёт QR-приз победителю после открытия сундука.
 * Владелец может посмотреть приз заранее, чтобы проверить загрузку.
 * Публичного URL у картинки нет.
 */
export const onRequestGet = async ({ request, env }: Ctx): Promise<Response> => {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;

  try {
    if (!auth.isOwner) {
      const state = await env.DB.prepare(
        'SELECT chest_opened FROM app_state WHERE telegram_id = ?',
      )
        .bind(auth.user.id)
        .first<{ chest_opened: number }>();

      if (!state?.chest_opened) return json({ error: 'chest_locked' }, 403);
    }

    const prize = await env.DB.prepare(
      'SELECT mime, image FROM prizes WHERE id = ?',
    )
      .bind('main')
      .first<{ mime: string; image: string }>();

    if (!prize) return json({ error: 'prize_not_found' }, 404);

    return json({ image: `data:${prize.mime};base64,${prize.image}` });
  } catch {
    return json({ error: 'db_unavailable' }, 500);
  }
};
