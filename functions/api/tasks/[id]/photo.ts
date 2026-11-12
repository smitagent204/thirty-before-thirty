import { TASK_BY_ID } from '../../../../shared/tasks';
import { humanizeIds, parseStoredDeductions } from '../../_ai';
import { authenticate, json, type Ctx } from '../../_shared';

interface PhotoRow {
  mime: string;
  image: string;
  score: number;
  verdict: string;
  reason: string;
  confidence: number;
  deductions: string;
  appealed_at: string | null;
  appeal_prev_score: number | null;
  appeal_text: string | null;
  appeal_prev_deductions: string | null;
  appeal_reason: string | null;
  created_at: string;
  proof_at?: string | null;
  proof_reason?: string | null;
  proof_prev_score?: number | null;
}

const BASE_COLUMNS = `mime, image, score, verdict, reason, confidence, deductions,
       appealed_at, appeal_prev_score, appeal_text,
       appeal_prev_deductions, appeal_reason`;

function loadPhotoRow(env: Ctx['env'], telegramId: number, taskId: string) {
  const query = (columns: string) =>
    env.DB.prepare(
      `SELECT ${columns}, created_at
       FROM photos
       WHERE telegram_id = ? AND task_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1`,
    )
      .bind(telegramId, taskId)
      .first<PhotoRow>();

  // Если миграция с доказательством оригинальности ещё не применена, фото
  // всё равно должно открываться — просто без блока доказательства.
  return query(`${BASE_COLUMNS}, proof_at, proof_reason, proof_prev_score`).catch(() =>
    query(BASE_COLUMNS),
  );
}

/**
 * Возвращает принятое фото выполненного задания.
 * Доступно только самому пользователю: чужие фото не отдаются.
 */
export const onRequestGet = async ({ request, env, params }: Ctx): Promise<Response> => {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;

  try {
    const row = await loadPhotoRow(env, auth.user.id, params.id);
    if (!row) return json({ error: 'photo_not_found' }, 404);

    // Тексты, сохранённые до правки, могли содержать служебные id рубрики.
    const task = TASK_BY_ID.get(params.id);
    const clean = (text: string | null) =>
      text && task ? humanizeIds(text, task) : text;

    return json({
      image: `data:${row.mime};base64,${row.image}`,
      score: row.score,
      verdict: row.verdict,
      reason: clean(row.reason),
      deductions: parseStoredDeductions(row.deductions),
      confidence: row.confidence,
      appealedAt: row.appealed_at,
      appealScoreBefore: row.appeal_prev_score,
      appealText: row.appeal_text,
      appealDeductions: parseStoredDeductions(row.appeal_prev_deductions),
      appealReason: clean(row.appeal_reason),
      proofAt: row.proof_at ?? null,
      proofReason: clean(row.proof_reason ?? null),
      proofScoreBefore: row.proof_prev_score ?? null,
      createdAt: row.created_at,
    });
  } catch {
    return json({ error: 'db_unavailable' }, 500);
  }
};
