import {
  buildVerificationPrompt,
  buildVerdictPrompt,
  type PreviousAttempt,
} from '../../shared/aiPrompt';
import type { AiDeduction, AiVerdict, Task, TaskRequirement } from '../../shared/types';
import type { Env } from './_shared';

const PASS_SCORE = 70;
const INVALID_SCORE = 15;
const FALLBACK_MISS_PERCENT = 35;

interface RawDeduction {
  id?: string;
  label?: string;
  /** missing — полный вес, partial — половина. percent оставлен для старых ответов. */
  state?: 'missing' | 'partial';
  percent?: number;
}

interface RawVerdict {
  reason: string;
  confidence: number;
  invalid: boolean;
  allVisible: boolean;
  deductions: RawDeduction[];
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

function normalize(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim();
}

function parseRawDeductions(raw: unknown): RawDeduction[] {
  if (!Array.isArray(raw)) return [];
  const items: RawDeduction[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const value = entry as Record<string, unknown>;
    const rawState = typeof value.state === 'string' ? value.state.toLowerCase() : '';
    const state =
      rawState === 'partial' || rawState === 'частично'
        ? 'partial'
        : rawState === 'missing' || rawState === 'нет' || rawState === 'отсутствует'
          ? 'missing'
          : undefined;
    const rawPercent = Number(value.percent ?? value.points ?? value.value);
    const percent = Number.isFinite(rawPercent) && rawPercent > 0 ? Math.round(rawPercent) : undefined;
    if (!state && percent === undefined) continue;

    const id = typeof value.id === 'string' ? value.id.trim() : undefined;
    const label = typeof value.label === 'string' ? value.label.trim() : undefined;
    items.push({ id, label, state, percent });
  }

  return items.slice(0, 8);
}

export function parseVerdict(text: string): RawVerdict | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    const raw = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const reason = typeof raw.reason === 'string' ? raw.reason.slice(0, 300).trim() : '';
    const confidence = Number(raw.confidence);
    if (!reason || !Number.isFinite(confidence)) return null;

    return {
      reason,
      confidence: Math.max(0, Math.min(1, confidence)),
      invalid: raw.invalid === true,
      // Старые ответы без all_visible считаем «всё видно», если нет вычетов.
      allVisible: raw.all_visible !== false,
      deductions: parseRawDeductions(raw.deductions),
    };
  } catch {
    return null;
  }
}

/** Читает deductions из D1: там лежит JSON, но старые строки могут быть пустыми. */
export function parseStoredDeductions(raw: unknown): AiDeduction[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const value = entry as Record<string, unknown>;
        const label = typeof value.label === 'string' ? value.label.trim() : '';
        const percent = Number(value.percent);
        if (!label || !Number.isFinite(percent) || percent <= 0) return null;
        return {
          ...(typeof value.id === 'string' ? { id: value.id } : {}),
          label,
          percent: Math.round(percent),
        } satisfies AiDeduction;
      })
      .filter((entry): entry is AiDeduction => Boolean(entry));
  } catch {
    return [];
  }
}

function matchRequirement(
  deduction: RawDeduction,
  required: TaskRequirement[],
): TaskRequirement | null {
  if (deduction.id) {
    const byId = required.find((item) => item.id === deduction.id);
    if (byId) return byId;
  }
  if (deduction.label) {
    const target = normalize(deduction.label);
    const byLabel = required.find((item) => normalize(item.label) === target);
    if (byLabel) return byLabel;
  }
  return null;
}

/** Оставляет только пункты из рубрики, обрезает проценты по весам и убирает дубли. */
export function applyDeductions(
  raw: RawDeduction[],
  required: TaskRequirement[],
): AiDeduction[] {
  const byId = new Map<string, AiDeduction>();

  for (const deduction of raw) {
    const requirement = matchRequirement(deduction, required);
    if (!requirement) continue;
    const percent =
      deduction.state === 'partial'
        ? Math.max(1, Math.round(requirement.weight / 2))
        : deduction.state === 'missing'
          ? requirement.weight
          : Math.max(
              1,
              Math.min(requirement.weight, deduction.percent ?? requirement.weight),
            );
    const current = byId.get(requirement.id);
    if (!current || percent > current.percent) {
      byId.set(requirement.id, {
        id: requirement.id,
        label: requirement.miss,
        percent,
      });
    }
  }

  return required
    .map((item) => byId.get(item.id))
    .filter((item): item is AiDeduction => Boolean(item));
}

function buildVerdict(
  task: Task,
  raw: RawVerdict,
  options: { forceMiss?: boolean } = {},
): AiVerdict {
  if (raw.invalid) {
    return {
      score: INVALID_SCORE,
      verdict: 'fail',
      reason: raw.reason,
      confidence: raw.confidence,
      deductions: [],
    };
  }

  let deductions = applyDeductions(raw.deductions, task.rubric.required);

  // Модель сказала, что чего-то не хватает, но не назвала пункт.
  // Не засчитываем вслепую: показываем общий вычет, чтобы фото можно было переснять.
  if (deductions.length === 0 && (!raw.allVisible || options.forceMiss)) {
    deductions = [
      {
        label: 'обязательные детали не читаются на фото',
        percent: FALLBACK_MISS_PERCENT,
      },
    ];
  }

  const total = deductions.reduce((sum, item) => sum + item.percent, 0);
  const score = Math.max(0, Math.min(100, 100 - total));

  return {
    score,
    verdict: score >= PASS_SCORE ? 'pass' : 'fail',
    reason: raw.reason,
    confidence: raw.confidence,
    deductions,
  };
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

type CheckState = 'ok' | 'partial' | 'missing';

interface Verification {
  checks: Map<string, CheckState>;
  reason: string | null;
}

function parseVerification(text: string): Verification {
  const checks = new Map<string, CheckState>();
  let reason: string | null = null;
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return { checks, reason };

  try {
    const raw = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof raw.reason === 'string') reason = raw.reason.slice(0, 300).trim() || null;
    if (!Array.isArray(raw.checks)) return { checks, reason };

    for (const entry of raw.checks) {
      if (!entry || typeof entry !== 'object') continue;
      const value = entry as Record<string, unknown>;
      const id = typeof value.id === 'string' ? value.id.trim() : '';
      const stateRaw = typeof value.state === 'string' ? value.state.toLowerCase() : '';
      const state: CheckState | null =
        stateRaw === 'ok' || stateRaw === 'visible' || stateRaw === 'done'
          ? 'ok'
          : stateRaw === 'partial' || stateRaw === 'частично'
            ? 'partial'
            : stateRaw === 'missing' || stateRaw === 'нет' || stateRaw === 'отсутствует'
              ? 'missing'
              : null;
      if (id && state) checks.set(id, state);
    }
  } catch {
    // Пустой или битый ответ — просто не применяем перепроверку.
  }

  return { checks, reason };
}

/**
 * Второй проход по тем же минусам. Если проверяющий видит предмет, минус
 * снимается: лучше недосчитать, чем незаслуженно провалить хорошее фото.
 */
async function verifyDeductions(
  env: Env,
  task: Task,
  image: string,
  deductions: AiDeduction[],
): Promise<{ deductions: RawDeduction[]; reason: string | null } | null> {
  const claims = deductions
    .filter((item): item is AiDeduction & { id: string } => Boolean(item.id))
    .map((item) => {
      const requirement = task.rubric.required.find((entry) => entry.id === item.id);
      // Проверяем формулировку требования, а не текст минуса: «бренды не читаются»
      // нельзя перепроверить как «чего не хватает».
      return { id: item.id, label: requirement?.label ?? item.label };
    });
  if (claims.length === 0) return null;

  try {
    const { checks, reason } = parseVerification(
      await runVision(env, buildVerificationPrompt(task, claims), image),
    );
    if (checks.size === 0) return null;

    const verified: RawDeduction[] = [];
    for (const claim of claims) {
      const state = checks.get(claim.id);
      // Нет вердикта по пункту — не считаем его доказанным минусом.
      if (!state || state === 'ok') continue;
      verified.push({ id: claim.id, state });
    }
    return { deductions: verified, reason };
  } catch {
    return null;
  }
}

/** Единая проверка фото для обычной загрузки, повторной попытки и переоценки. */
export async function evaluatePhoto(
  env: Env,
  task: Task,
  image: string,
  previous?: PreviousAttempt | null,
): Promise<AiVerdict> {
  const prompt = buildVerdictPrompt(task, previous);
  let raw = parseVerdict(await runVision(env, prompt, image));
  if (!raw) throw new Error('ai_invalid_response');

  // Если модель говорит «чего-то не хватает», но не назвала ни одного
  // существующего пункта — просим один раз повторить, иначе оценка будет
  // без объяснения или с придуманным критерием.
  const mapped = applyDeductions(raw.deductions, task.rubric.required);
  const needsRepair =
    !raw.invalid && mapped.length === 0 && (!raw.allVisible || raw.deductions.length > 0);
  if (needsRepair) {
    try {
      const repair = parseVerdict(
        await runVision(
          env,
          `${prompt}\n\nТвой ответ неполный: all_visible = false, но deductions пустой. Верни ТОЛЬКО JSON заново и перечисли в deductions все обязательные пункты, которых не видно, с их id и state (missing или partial).`,
          image,
        ),
      );
      if (repair) raw = repair;
    } catch {
      // Оставляем первый ответ, ниже сработает общий вычет.
    }
  }

  let verdict = buildVerdict(task, raw);

  // Второй проход только по заявленным минусам: убирает ложные «нет объекта»,
  // когда предмет на самом деле есть, но модель его не заметила.
  if (!raw.invalid && verdict.deductions && verdict.deductions.length > 0) {
    const verified = await verifyDeductions(env, task, image, verdict.deductions);
    if (verified) {
      raw = {
        ...raw,
        deductions: verified.deductions,
        allVisible: verified.deductions.length === 0,
        reason: verified.reason ?? raw.reason,
      };
      verdict = buildVerdict(task, raw);
    }
  }

  return verdict;
}
