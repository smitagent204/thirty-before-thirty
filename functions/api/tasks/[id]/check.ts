import { computeStatuses } from '../../../../shared/progress';
import { TASK_BY_ID } from '../../../../shared/tasks';
import { evaluatePhoto, parseStoredDeductions } from '../../_ai';
import {
  authenticate,
  json,
  loadState,
  readJson,
  type Ctx,
} from '../../_shared';

const MAX_BASE64 = 1_500_000;
const IMAGE_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/;

interface CheckBody {
  image?: string;
  forceFail?: boolean;
}

export const onRequestPost = async ({ request, env, params }: Ctx): Promise<Response> => {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;

  const task = TASK_BY_ID.get(params.id);
  if (!task) return json({ error: 'task_not_found' }, 404);

  const body = await readJson<CheckBody>(request);
  const image = body?.image;
  const match = typeof image === 'string' ? IMAGE_RE.exec(image) : null;
  if (!match) return json({ error: 'invalid_image' }, 400);

  const base64 = match[2].replace(/\s/g, '');
  if (base64.length > MAX_BASE64) return json({ error: 'image_too_large' }, 413);

  try {
    const state = await loadState(env, auth.user.id);
    const alreadyCompleted = state.completed.includes(task.id);

    // Повторная загрузка разрешена только для уже выполненного задания:
    // так можно сделать «работу над ошибками», но нельзя открыть закрытое задание.
    if (!alreadyCompleted) {
      const statuses = computeStatuses(state.completed);
      if (statuses.get(task.id) !== 'available') {
        return json({ error: 'task_locked' }, 409);
      }
    }

    const previousRow = alreadyCompleted
      ? await env.DB.prepare(
          `SELECT score, reason, deductions
           FROM photos
           WHERE telegram_id = ? AND task_id = ?
           ORDER BY created_at DESC, rowid DESC
           LIMIT 1`,
        )
          .bind(auth.user.id, task.id)
          .first<{ score: number; reason: string; deductions: string }>()
      : null;

    const previous = previousRow
      ? {
          score: previousRow.score,
          reason: previousRow.reason,
          deductions: parseStoredDeductions(previousRow.deductions),
        }
      : null;

    // В dev-режиме владелец может принудительно проверить ветку провала.
    if (body?.forceFail && auth.isOwner) {
      return json({
        pass: false,
        score: 38,
        verdict: 'fail',
        reason: 'Dev-режим: принудительный провал проверки.',
        confidence: 0.99,
        forced: true,
        recheck: alreadyCompleted,
        previousScore: previous?.score ?? null,
        deductions: [],
      });
    }

    const verdict = await evaluatePhoto(env, task, match[0], previous);
    const passed = verdict.verdict === 'pass' && verdict.score >= 70;

    if (!passed) {
      return json({
        pass: false,
        score: verdict.score,
        verdict: 'fail',
        reason: verdict.reason,
        confidence: verdict.confidence,
        recheck: alreadyCompleted,
        previousScore: previous?.score ?? null,
        deductions: verdict.deductions ?? [],
      });
    }

    // Уже засчитанное задание не может стать хуже: сохраняем новый кадр,
    // только если он улучшил результат. Баллы при этом не начисляются повторно.
    const improved = !alreadyCompleted || !previous || verdict.score > previous.score;
    if (!improved) {
      return json({
        pass: true,
        score: verdict.score,
        verdict: 'pass',
        reason: verdict.reason,
        confidence: verdict.confidence,
        completed: true,
        recheck: true,
        saved: false,
        previousScore: previous?.score ?? null,
        deductions: verdict.deductions ?? [],
        points: 0,
      });
    }

    const photoId = crypto.randomUUID();
    const statements = [
      env.DB.prepare(
        `INSERT INTO photos
           (id, telegram_id, task_id, mime, image, score, verdict, reason, confidence, deductions)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        photoId,
        auth.user.id,
        task.id,
        match[1],
        base64,
        verdict.score,
        verdict.verdict,
        verdict.reason,
        verdict.confidence,
        JSON.stringify(verdict.deductions ?? []),
      ),
    ];

    if (alreadyCompleted) {
      statements.push(
        env.DB.prepare(
          'UPDATE completions SET photo_id = ? WHERE telegram_id = ? AND task_id = ?',
        ).bind(photoId, auth.user.id, task.id),
      );
    } else {
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO completions
             (telegram_id, task_id, points, manual, photo_id)
           VALUES (?, ?, ?, 0, ?)`,
        ).bind(auth.user.id, task.id, task.points, photoId),
      );
    }

    await env.DB.batch(statements);

    return json({
      pass: true,
      score: verdict.score,
      verdict: 'pass',
      reason: verdict.reason,
      confidence: verdict.confidence,
      completed: true,
      recheck: alreadyCompleted,
      saved: true,
      previousScore: previous?.score ?? null,
      deductions: verdict.deductions ?? [],
      photoId,
      points: alreadyCompleted ? 0 : task.points,
    });
  } catch {
    return json({ error: 'ai_unavailable' }, 502);
  }
};
