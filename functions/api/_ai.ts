import { buildVerdictPrompt, type PreviousAttempt } from '../../shared/aiPrompt';
import type { AiVerdict, Task } from '../../shared/types';
import type { Env } from './_shared';

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

export function parseVerdict(text: string): AiVerdict | null {
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

/** Единая проверка фото для обычной загрузки и повторной работы над ошибками. */
export async function evaluatePhoto(
  env: Env,
  task: Task,
  image: string,
  previous?: PreviousAttempt | null,
): Promise<AiVerdict> {
  const prompt = buildVerdictPrompt(task, previous);
  const text = await runVision(env, prompt, image);
  const verdict = parseVerdict(text);
  if (!verdict) throw new Error('ai_invalid_response');
  return verdict;
}
