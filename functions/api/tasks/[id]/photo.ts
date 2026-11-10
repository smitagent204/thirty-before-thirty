import { authenticate, json, type Ctx } from '../../_shared';

/**
 * Возвращает принятое фото выполненного задания.
 * Доступно только самому пользователю: чужие фото не отдаются.
 */
export const onRequestGet = async ({ request, env, params }: Ctx): Promise<Response> => {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;

  try {
    const row = await env.DB.prepare(
      `SELECT mime, image, score, verdict, confidence, created_at
       FROM photos
       WHERE telegram_id = ? AND task_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
      .bind(auth.user.id, params.id)
      .first<{
        mime: string;
        image: string;
        score: number;
        verdict: string;
        confidence: number;
        created_at: string;
      }>();

    if (!row) return json({ error: 'photo_not_found' }, 404);

    return json({
      image: `data:${row.mime};base64,${row.image}`,
      score: row.score,
      verdict: row.verdict,
      confidence: row.confidence,
      createdAt: row.created_at,
    });
  } catch {
    return json({ error: 'db_unavailable' }, 500);
  }
};
