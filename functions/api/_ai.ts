import { buildVerdictPrompt, type Deduction, type PreviousAttempt } from '../../shared/aiPrompt';
import type { AiVerdict, Task } from '../../shared/types';
import type { Env } from './_shared';

const MAX_DEDUCTIONS = 3;

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

function parseDeductions(raw: unknown): Deduction[] {
  if (!Array.isArray(raw)) return [];
  const items: Deduction[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const value = entry as Record<string, unknown>;
    const labelRaw =
      typeof value.label === 'string'
        ? value.label
        : typeof value.reason === 'string'
          ? value.reason
          : '';
    const label = labelRaw
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^за\s+/i, '')
      .replace(/[.,;:]+$/, '');
    const percent = Number(value.percent ?? value.points ?? value.value);
    if (!label || !Number.isFinite(percent) || percent <= 0) continue;
    items.push({ label: label.slice(0, 90), percent: Math.round(percent) });
  }

  return items.slice(0, MAX_DEDUCTIONS);
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
      deductions: parseDeductions(raw.deductions),
    };
  } catch {
    return null;
  }
}

/**
 * Приводит разбивку к ровно `gap` процентам. Модель часто ошибается в сумме,
 * а оценку уже выставила — масштабируем доли, чтобы арифметика сходилась.
 */
export function normalizeDeductions(
  deductions: Deduction[] | undefined,
  gap: number,
): Deduction[] {
  const items = (deductions ?? []).filter((item) => item.percent > 0).slice(0, MAX_DEDUCTIONS);
  if (gap <= 0 || items.length === 0) return [];
  if (gap < items.length) {
    return items.slice(0, gap).map((item) => ({ ...item, percent: 1 }));
  }

  const sum = items.reduce((total, item) => total + item.percent, 0);
  let remaining = gap;
  const result: Deduction[] = [];

  items.forEach((item, index) => {
    const isLast = index === items.length - 1;
    const fairShare = Math.round((item.percent * gap) / sum);
    const percent = isLast
      ? remaining
      : Math.max(1, Math.min(remaining - (items.length - index - 1), fairShare));
    result.push({ label: item.label, percent });
    remaining -= percent;
  });

  return result;
}

/** Убирает проценты, если модель всё-таки вписала их в текст комментария. */
function stripDeductionMentions(reason: string): string {
  return reason
    .replace(/\s*[−–-]\s*\d+\s*%\s*[—–-]\s*за\s+[^.;]+/gi, '')
    .replace(/\s*[−–-]\s*\d+\s*%/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[,;]?\s*\b(но|а|однако|только)\s*([.!?])/gi, '$2')
    .replace(/\s+([.,;!?])/g, '$1')
    .trim();
}

function formatReason(verdict: AiVerdict): string {
  const reason = stripDeductionMentions(verdict.reason);
  if (verdict.verdict !== 'pass') return reason;

  const items = normalizeDeductions(verdict.deductions, 100 - verdict.score);
  if (items.length === 0) return reason;

  const tail = items.map((item) => `−${item.percent}% — за ${item.label}`).join('; ');
  const base = reason.replace(/[.!…\s]+$/, '');
  return base ? `${base}. ${tail}.` : `${tail}.`;
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
    max_tokens: 700,
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

/** Единая проверка фото для обычной загрузки, повторной попытки и переоценки. */
export async function evaluatePhoto(
  env: Env,
  task: Task,
  image: string,
  previous?: PreviousAttempt | null,
): Promise<AiVerdict> {
  const prompt = buildVerdictPrompt(task, previous);
  let verdict = parseVerdict(await runVision(env, prompt, image));
  if (!verdict) throw new Error('ai_invalid_response');

  // Если модель забыла разбивку, просим один раз повторить ответ с ней:
  // иначе пользователь снова увидит оценку без объяснения, за что сняли.
  if (verdict.verdict === 'pass' && verdict.score < 100 && !verdict.deductions?.length) {
    const gap = 100 - verdict.score;
    try {
      const repair = parseVerdict(
        await runVision(
          env,
          `${prompt}\n\nТвой ответ неполный: не заполнен deductions. Верни ТОЛЬКО JSON заново, добавив 1–3 конкретных пункта в deductions, чтобы сумма percent была ровно ${gap}.`,
          image,
        ),
      );
      if (repair?.deductions?.length) verdict = repair;
    } catch {
      // Оставляем первый ответ — лучше оценка без разбивки, чем ошибка.
    }
  }

  return { ...verdict, reason: formatReason(verdict) };
}
