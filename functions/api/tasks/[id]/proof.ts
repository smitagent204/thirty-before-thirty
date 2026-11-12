import { TASK_BY_ID } from '../../../../shared/tasks';
import { parseStoredDeductions, proveOriginality } from '../../_ai';
import { fingerprintDistance, isFingerprint } from '../../_image';
import { authenticate, json, readJson, type Ctx } from '../../_shared';

const MAX_BASE64 = 1_500_000;
const IMAGE_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/;
/** Расстояние, при котором второй кадр считаем копией первого. */
const SAME_IMAGE_DISTANCE = 6;

interface ProofBody {
  image?: string;
  fingerprint?: string;
}

/**
 * Доказательство оригинальности: второй снимок того же места с другого ракурса.
 * Основное фото остаётся в профиле и в аллее, второй кадр только снимает минус
 * за сомнение. Попытка одна — как и у апелляции.
 */
export const onRequestPost = async ({ request, env, params }: Ctx): Promise<Response> => {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;

  const task = TASK_BY_ID.get(params.id);
  if (!task) return json({ error: 'task_not_found' }, 404);

  const body = await readJson<ProofBody>(request);
  const image = body?.image;
  const match = typeof image === 'string' ? IMAGE_RE.exec(image) : null;
  if (!match) return json({ error: 'invalid_image' }, 400);

  const base64 = match[2].replace(/\s/g, '');
  if (base64.length > MAX_BASE64) return json({ error: 'image_too_large' }, 413);

  try {
    const photo = await env.DB.prepare(
      `SELECT id, mime, image, score, deductions, proof_at, fingerprint
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
        deductions: string;
        proof_at: string | null;
        fingerprint: string | null;
      }>();

    if (!photo) return json({ error: 'photo_not_found' }, 404);
    if (photo.proof_at) return json({ error: 'proof_already_used' }, 409);

    const current = parseStoredDeductions(photo.deductions);
    if (!current.some((item) => item.kind === 'origin')) {
      return json({ error: 'nothing_to_prove' }, 409);
    }

    // Тот же файл, кадрирование или повторная отправка: попытку не тратим,
    // сразу говорим, что нужен другой ракурс.
    const fingerprint = isFingerprint(body?.fingerprint)
      ? body!.fingerprint.trim().toLowerCase()
      : null;
    if (
      fingerprint &&
      photo.fingerprint &&
      isFingerprint(photo.fingerprint) &&
      fingerprintDistance(fingerprint, photo.fingerprint.trim().toLowerCase()) <=
        SAME_IMAGE_DISTANCE
    ) {
      return json({ error: 'same_photo' }, 409);
    }

    const outcome = await proveOriginality(env, task, [
      `data:${photo.mime};base64,${photo.image}`,
      match[0],
    ]);

    const proofAt = new Date().toISOString();
    const next = outcome.accepted
      ? current.filter((item) => item.kind !== 'origin')
      : current;
    const total = next.reduce((sum, item) => sum + item.percent, 0);
    const score = Math.max(0, 100 - total);
    const verdict = score >= 70 ? 'pass' : 'fail';

    const updated = (await env.DB.prepare(
      `UPDATE photos
       SET score = ?, verdict = ?, deductions = ?,
           proof_at = ?, proof_reason = ?, proof_prev_score = ?
       WHERE id = ? AND proof_at IS NULL`,
    )
      .bind(
        score,
        verdict,
        JSON.stringify(next),
        proofAt,
        outcome.reason,
        photo.score,
        photo.id,
      )
      .run()) as { meta?: { changes?: number } };

    // Два одновременных доказательства не должны оба сработать.
    if (typeof updated.meta?.changes === 'number' && updated.meta.changes === 0) {
      return json({ error: 'proof_already_used' }, 409);
    }

    return json({
      taskId: task.id,
      title: task.title,
      accepted: outcome.accepted,
      scoreBefore: photo.score,
      score,
      verdict,
      deductions: next,
      proofReason: outcome.reason,
      proofAt,
    });
  } catch {
    return json({ error: 'ai_unavailable' }, 502);
  }
};
