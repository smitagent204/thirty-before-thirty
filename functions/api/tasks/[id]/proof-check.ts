import { computeStatuses } from '../../../../shared/progress';
import { TASK_BY_ID } from '../../../../shared/tasks';
import type { PhotoMeta } from '../../../../shared/types';
import { evaluatePhoto, parseStoredDeductions, proveOriginality } from '../../_ai';
import {
  fingerprintDistance,
  isFingerprint,
  isScreenShape,
  readImageSize,
  sanitizePhotoMeta,
} from '../../_image';
import { saveApprovedPhoto } from '../../_store';
import { authenticate, json, loadState, readJson, type Ctx } from '../../_shared';

const MAX_BASE64 = 1_500_000;
const IMAGE_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/;
/** Расстояние Хэмминга, при котором кадры считаются одним и тем же снимком. */
const DUPLICATE_DISTANCE = 6;

interface ProofCheckBody {
  /** Основной кадр, который забраковали как скачанный. */
  image?: string;
  /** Второй снимок того же места с другого ракурса. */
  proof?: string;
  fingerprint?: string;
  proofFingerprint?: string;
  meta?: PhotoMeta;
}

/**
 * Проверка фото вместе с доказательством оригинальности. Нужна, когда кадр
 * забраковали как скачанный и он не сохранился: отклонённые фото мы не храним,
 * поэтому оба снимка приходят в одном запросе. Если второй ракурс подтверждает
 * сцену, кадр пересматривается без подозрения и сохраняется обычным порядком.
 */
export const onRequestPost = async ({ request, env, params }: Ctx): Promise<Response> => {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;

  const task = TASK_BY_ID.get(params.id);
  if (!task) return json({ error: 'task_not_found' }, 404);

  const body = await readJson<ProofCheckBody>(request);
  const imageMatch = typeof body?.image === 'string' ? IMAGE_RE.exec(body.image) : null;
  const proofMatch = typeof body?.proof === 'string' ? IMAGE_RE.exec(body.proof) : null;
  if (!imageMatch || !proofMatch) return json({ error: 'invalid_image' }, 400);

  const base64 = imageMatch[2].replace(/\s/g, '');
  if (base64.length > MAX_BASE64) return json({ error: 'image_too_large' }, 413);
  if (proofMatch[2].replace(/\s/g, '').length > MAX_BASE64) {
    return json({ error: 'image_too_large' }, 413);
  }

  try {
    const state = await loadState(env, auth.user.id);
    const alreadyCompleted = state.completed.includes(task.id);

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

    // Скриншот не может быть доказательством фотографии.
    if (
      !task.allowScreenshot &&
      !task.allowCollage &&
      isScreenShape(readImageSize(base64))
    ) {
      return json({
        accepted: false,
        reason:
          'Кадр выглядит как скриншот экрана. Задание просит фотографию: сними то, что происходит вокруг.',
      });
    }

    const fingerprint = isFingerprint(body?.fingerprint)
      ? body!.fingerprint.trim().toLowerCase()
      : null;
    const proofFingerprint = isFingerprint(body?.proofFingerprint)
      ? body!.proofFingerprint.trim().toLowerCase()
      : null;

    // Второй кадр — копия первого: сравнивать нечего.
    if (
      fingerprint &&
      proofFingerprint &&
      fingerprintDistance(fingerprint, proofFingerprint) <= DUPLICATE_DISTANCE
    ) {
      return json({
        accepted: false,
        reason: 'Это тот же кадр. Сними с другой точки: шаг в сторону или другой фон.',
      });
    }

    // Тот же кадр уже был в квесте за другое задание или у другого участника.
    if (fingerprint) {
      const rows = await env.DB.prepare(
        `SELECT telegram_id, task_id, fingerprint FROM photos WHERE fingerprint IS NOT NULL`,
      ).all<{ telegram_id: string; task_id: string; fingerprint: string }>();

      const repeat = (rows.results ?? []).find((row) => {
        if (!isFingerprint(row.fingerprint)) return false;
        if (row.telegram_id === auth.user.id && row.task_id === task.id) return false;
        return (
          fingerprintDistance(fingerprint, row.fingerprint.trim().toLowerCase()) <=
          DUPLICATE_DISTANCE
        );
      });

      if (repeat) {
        return json({
          accepted: false,
          reason:
            'Этот же кадр уже участвовал в квесте — за другое задание или у другого участника. Нужен свежий снимок.',
        });
      }
    }

    const outcome = await proveOriginality(env, task, [imageMatch[0], proofMatch[0]]);
    if (!outcome.accepted) {
      return json({ accepted: false, reason: outcome.reason });
    }

    // Оригинальность доказана: пересматриваем кадр без подозрения, но
    // содержание и рубрику проверяем заново.
    const verdict = await evaluatePhoto(
      env,
      task,
      imageMatch[0],
      previous,
      sanitizePhotoMeta(body?.meta),
      { trustOrigin: true },
    );

    const passed = verdict.verdict === 'pass' && verdict.score >= 70;
    if (!passed) {
      return json({
        accepted: true,
        pass: false,
        score: verdict.score,
        verdict: 'fail',
        reason: verdict.reason,
        confidence: verdict.confidence,
        deductions: verdict.deductions ?? [],
        saved: false,
        points: 0,
        proofReason: outcome.reason,
      });
    }

    const improved = !alreadyCompleted || !previous || verdict.score > previous.score;
    if (!improved) {
      return json({
        accepted: true,
        pass: true,
        score: verdict.score,
        verdict: 'pass',
        reason: verdict.reason,
        confidence: verdict.confidence,
        deductions: verdict.deductions ?? [],
        completed: true,
        recheck: true,
        saved: false,
        previousScore: previous?.score ?? null,
        points: 0,
        proofReason: outcome.reason,
      });
    }

    let photoId: string;
    try {
      photoId = await saveApprovedPhoto(env, {
        telegramId: auth.user.id,
        task,
        mime: imageMatch[1],
        base64,
        fingerprint,
        verdict,
        alreadyCompleted,
      });
    } catch {
      return json({ error: 'db_unavailable' }, 500);
    }

    return json({
      accepted: true,
      pass: true,
      score: verdict.score,
      verdict: 'pass',
      reason: verdict.reason,
      confidence: verdict.confidence,
      deductions: verdict.deductions ?? [],
      completed: true,
      recheck: alreadyCompleted,
      saved: true,
      previousScore: previous?.score ?? null,
      photoId,
      points: alreadyCompleted ? 0 : task.points,
      proofReason: outcome.reason,
    });
  } catch {
    return json({ error: 'ai_unavailable' }, 502);
  }
};
