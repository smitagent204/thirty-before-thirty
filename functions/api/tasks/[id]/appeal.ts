import { TASK_BY_ID } from '../../../../shared/tasks';
import { APPEAL_MAX_CHARS } from '../../../../shared/types';
import { appealVerdict, parseStoredDeductions } from '../../_ai';
import { authenticate, json, readJson, type Ctx } from '../../_shared';

interface AppealBody {
  text?: string;
}

/**
 * Апелляция к оценке последнего сохранённого фото. Одна попытка на фото:
 * повторная загрузка создаёт новую запись и новую возможность.
 */
export const onRequestPost = async ({ request, env, params }: Ctx): Promise<Response> => {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;

  const task = TASK_BY_ID.get(params.id);
  if (!task) return json({ error: 'task_not_found' }, 404);

  const body = await readJson<AppealBody>(request);
  const note = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!note) return json({ error: 'appeal_empty' }, 400);
  if (note.length > APPEAL_MAX_CHARS) return json({ error: 'appeal_too_long' }, 400);

  try {
    const photo = await env.DB.prepare(
      `SELECT id, mime, image, score, verdict, reason, deductions, appealed_at
       FROM photos
       WHERE telegram_id = ? AND task_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1`,
    )
      .bind(auth.user.id, task.id)
      .first<{
        id: string;
        mime: string;
        image: string;
        score: number;
        verdict: string;
        reason: string;
        deductions: string;
        appealed_at: string | null;
      }>();

    if (!photo) return json({ error: 'photo_not_found' }, 404);
    if (photo.appealed_at) return json({ error: 'appeal_already_used' }, 409);

    const current = parseStoredDeductions(photo.deductions);
    if (current.length === 0) return json({ error: 'nothing_to_appeal' }, 409);

    const verdict = await appealVerdict(
      env,
      task,
      `data:${photo.mime};base64,${photo.image}`,
      current,
      note,
    );
    const appealedAt = new Date().toISOString();

    const updated = (await env.DB.prepare(
      `UPDATE photos
       SET score = ?, verdict = ?, reason = ?, confidence = ?, deductions = ?,
           appealed_at = ?, appeal_text = ?, appeal_prev_score = ?
       WHERE id = ? AND appealed_at IS NULL`,
    )
      .bind(
        verdict.score,
        verdict.verdict,
        verdict.reason,
        verdict.confidence,
        JSON.stringify(verdict.deductions ?? []),
        appealedAt,
        note,
        photo.score,
        photo.id,
      )
      .run()) as { meta?: { changes?: number } };

    // Две одновременные апелляции не должны обе сработать на одном фото.
    if (typeof updated.meta?.changes === 'number' && updated.meta.changes === 0) {
      return json({ error: 'appeal_already_used' }, 409);
    }

    return json({
      taskId: task.id,
      title: task.title,
      scoreBefore: photo.score,
      score: verdict.score,
      verdict: verdict.verdict,
      reason: verdict.reason,
      deductions: verdict.deductions ?? [],
      relieved: verdict.relieved,
      applied: verdict.applied,
      appealedAt,
    });
  } catch {
    return json({ error: 'ai_unavailable' }, 502);
  }
};
