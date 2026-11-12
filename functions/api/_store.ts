import type { AiVerdict, Task } from '../../shared/types';
import type { Env } from './_shared';

export interface SavePhotoInput {
  telegramId: number;
  task: Task;
  mime: string;
  base64: string;
  fingerprint: string | null;
  verdict: AiVerdict;
  /** Задание уже было выполнено: новый кадр заменяет фото, баллы не начисляются. */
  alreadyCompleted: boolean;
}

/**
 * Сохраняет принятый кадр и связывает его с выполнением задания. Используется
 * обычной проверкой и проверкой с доказательством оригинальности.
 */
export async function saveApprovedPhoto(env: Env, input: SavePhotoInput): Promise<string> {
  const photoId = crypto.randomUUID();
  const statements = [
    env.DB.prepare(
      `INSERT INTO photos
         (id, telegram_id, task_id, mime, image, score, verdict, reason, confidence, deductions, fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      photoId,
      input.telegramId,
      input.task.id,
      input.mime,
      input.base64,
      input.verdict.score,
      input.verdict.verdict,
      input.verdict.reason,
      input.verdict.confidence,
      JSON.stringify(input.verdict.deductions ?? []),
      input.fingerprint,
    ),
  ];

  if (input.alreadyCompleted) {
    statements.push(
      env.DB.prepare(
        'UPDATE completions SET photo_id = ? WHERE telegram_id = ? AND task_id = ?',
      ).bind(photoId, input.telegramId, input.task.id),
    );
  } else {
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO completions
           (telegram_id, task_id, points, manual, photo_id)
         VALUES (?, ?, ?, 0, ?)`,
      ).bind(input.telegramId, input.task.id, input.task.points, photoId),
    );
  }

  await env.DB.batch(statements);
  return photoId;
}
