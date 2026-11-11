import { parseStoredDeductions } from '../../_ai';
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
      `SELECT mime, image, score, verdict, reason, confidence, deductions,
              appealed_at, appeal_prev_score, created_at
       FROM photos
       WHERE telegram_id = ? AND task_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1`,
    )
      .bind(auth.user.id, params.id)
      .first<{
        mime: string;
        image: string;
        score: number;
        verdict: string;
        reason: string;
        confidence: number;
        deductions: string;
        appealed_at: string | null;
        appeal_prev_score: number | null;
        created_at: string;
      }>();

    if (!row) return json({ error: 'photo_not_found' }, 404);

    return json({
      image: `data:${row.mime};base64,${row.image}`,
      score: row.score,
      verdict: row.verdict,
      reason: row.reason,
      deductions: parseStoredDeductions(row.deductions),
      confidence: row.confidence,
      appealedAt: row.appealed_at,
      appealScoreBefore: row.appeal_prev_score,
      createdAt: row.created_at,
    });
  } catch {
    return json({ error: 'db_unavailable' }, 500);
  }
};
