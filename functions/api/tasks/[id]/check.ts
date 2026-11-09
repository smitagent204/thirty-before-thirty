import { buildVerdictPrompt } from '../../../../shared/aiPrompt';
import { computeStatuses } from '../../../../shared/progress';
import { TASK_BY_ID } from '../../../../shared/tasks';
import type { AiVerdict } from '../../../../shared/types';
import {
  authenticate,
  json,
  loadState,
  readJson,
  type Ctx,
  type Env,
} from '../../_shared';

const MAX_BASE64 = 1_500_000;
const IMAGE_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/;

interface CheckBody {
  image?: string;
  forceFail?: boolean;
}

function extractText(result: unknown): string {
  if (typeof result === 'string') return result;
  const value = result as Record<string, any>;
  if (typeof value.response === 'string') return value.response;
  if (typeof value.result?.response === 'string') return value.result.response;

  const content = value.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === 'string' ? part : part?.text ?? ''))
      .join('');
  }
  return '';
}

function parseVerdict(text: string): AiVerdict | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    const raw = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const score = Number(raw.score);
    const confidence = Number(raw.confidence);
    const verdict = raw.verdict === 'pass' || raw.verdict === 'fail' ? raw.verdict : null;
    const reason = typeof raw.reason === 'string' ? raw.reason.slice(0, 300).trim() : '';

    if (!verdict || !reason || !Number.isFinite(score) || !Number.isFinite(confidence)) {
      return null;
    }

    return {
      score: Math.max(0, Math.min(100, Math.round(score))),
      verdict,
      reason,
      confidence: Math.max(0, Math.min(1, confidence)),
    };
  } catch {
    return null;
  }
}

async function askModel(
  env: Env,
  model: string,
  prompt: string,
  image: string,
): Promise<string> {
  const result = await env.AI.run(model, {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: image } },
        ],
      },
    ],
    max_tokens: 500,
    temperature: 0.1,
  });
  return extractText(result).trim();
}

async function runVision(env: Env, prompt: string, image: string): Promise<string> {
  const models = [
    env.AI_MODEL || '@cf/meta/llama-4-scout-17b-16e-instruct',
    env.AI_FALLBACK_MODEL || '@cf/meta/llama-3.2-11b-vision-instruct',
  ];

  let lastError: unknown = null;
  for (const model of models) {
    try {
      const text = await askModel(env, model, prompt, image);
      if (text) return text;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('empty_ai_response');
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
    if (state.completed.includes(task.id)) {
      return json({ error: 'already_completed', ...state }, 409);
    }

    const statuses = computeStatuses(state.completed);
    if (statuses.get(task.id) !== 'available') {
      return json({ error: 'task_locked' }, 409);
    }

    // В dev-режиме владелец может принудительно проверить ветку провала.
    if (body?.forceFail && auth.isOwner) {
      return json({
        pass: false,
        score: 38,
        verdict: 'fail',
        reason: 'Dev-режим: принудительный провал проверки.',
        confidence: 0.99,
        forced: true,
      });
    }

    const prompt = buildVerdictPrompt(task);
    const text = await runVision(env, prompt, match[0]);
    const verdict = parseVerdict(text);
    if (!verdict) return json({ error: 'ai_invalid_response' }, 502);

    const passed = verdict.verdict === 'pass' && verdict.score >= 70;
    if (!passed) {
      return json({
        pass: false,
        score: verdict.score,
        verdict: 'fail',
        reason: verdict.reason,
        confidence: verdict.confidence,
      });
    }

    const photoId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO photos
           (id, telegram_id, task_id, mime, image, score, verdict, reason, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO completions
           (telegram_id, task_id, points, manual, photo_id)
         VALUES (?, ?, ?, 0, ?)`,
      ).bind(auth.user.id, task.id, task.points, photoId),
    ]);

    return json({
      pass: true,
      score: verdict.score,
      verdict: 'pass',
      reason: verdict.reason,
      confidence: verdict.confidence,
      completed: true,
      photoId,
      points: task.points,
    });
  } catch {
    return json({ error: 'ai_unavailable' }, 502);
  }
};
