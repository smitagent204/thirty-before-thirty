import {
  buildAppealPrompt,
  buildAppealRecheckPrompt,
  buildProofPrompt,
  buildVerificationPrompt,
  buildVerdictPrompt,
  type AppealClaim,
  type PreviousAttempt,
} from '../../shared/aiPrompt';
import type { AiDeduction, AiVerdict, Task, TaskRequirement } from '../../shared/types';
import type { Env } from './_shared';

const PASS_SCORE = 70;
/** Посторонний кадр, скриншот или монтаж не заслуживают «утешительных» баллов. */
const INVALID_SCORE = 0;
const FALLBACK_MISS_PERCENT = 35;
/** Небольшой штраф, если кадр похож на скачанный, но прямых улик нет. */
const SOURCE_PENALTY = 20;
const SOURCE_DOWNLOADED_REASON =
  'Кадр выглядит как скачанный из интернета — для квеста нужен свой снимок с места.';

interface RawDeduction {
  id?: string;
  label?: string;
  /** missing — пункта нет, partial — виден частично. */
  state?: 'missing' | 'partial';
  /**
   * Доля веса, которой не хватает: 0.05–1. Даёт живые оценки вроде −7 или −24
   * вместо жёстких −15 и −35. Без severity работает прежняя схема (полный вес
   * за missing, половина за partial).
   */
  severity?: number;
  /** Оставлен для старых ответов без state. */
  percent?: number;
}

type RawSource = 'own' | 'suspicious' | 'downloaded';

interface RawVerdict {
  reason: string;
  confidence: number;
  invalid: boolean;
  allVisible: boolean;
  /** Происхождение кадра: скачанный или стоковый не должен приносить баллы. */
  source: RawSource;
  sourceNote: string | null;
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

    // severity — доля веса, которой не хватает. Модель может прислать 0.6 или
    // 60 — приводим к шкале 0–1, чтобы «−9%» и «−23%» были возможны.
    const rawSeverity = Number(value.severity ?? value.share ?? value.degree);
    let severity: number | undefined;
    if (Number.isFinite(rawSeverity) && rawSeverity > 0) {
      const normalized = rawSeverity > 1 ? rawSeverity / 100 : rawSeverity;
      severity = Math.max(0.05, Math.min(1, normalized));
    }

    if (!state && percent === undefined && severity === undefined) continue;

    const id = typeof value.id === 'string' ? value.id.trim() : undefined;
    const label = typeof value.label === 'string' ? value.label.trim() : undefined;
    items.push({ id, label, state, percent, severity });
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
    const invalid = raw.invalid === true;
    const reason = typeof raw.reason === 'string' ? raw.reason.slice(0, 300).trim() : '';
    const confidence = Number(raw.confidence);
    if ((!reason && !invalid) || !Number.isFinite(confidence)) return null;

    const rawSource = typeof raw.source === 'string' ? raw.source.toLowerCase() : '';
    const source: RawSource =
      rawSource === 'downloaded' || rawSource === 'скачано' || rawSource === 'stock'
        ? 'downloaded'
        : rawSource === 'suspicious' || rawSource === 'подозрительно'
          ? 'suspicious'
          : 'own';
    const sourceNote =
      typeof raw.source_note === 'string' && raw.source_note.trim()
        ? raw.source_note.trim().slice(0, 160)
        : null;

    return {
      // Для invalid пустая похвала не ошибка: покажем понятное объяснение.
      reason: reason || 'Фото не относится к заданию.',
      confidence: Math.max(0, Math.min(1, confidence)),
      invalid,
      // Старые ответы без all_visible считаем «всё видно», если нет вычетов.
      allVisible: raw.all_visible !== false,
      source,
      sourceNote,
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
          ...(value.kind === 'origin' ? { kind: 'origin' as const } : {}),
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
    // severity задаёт живую долю штрафа; без неё — прежняя схема «половина
    // за partial, полный вес за missing». Верхняя граница — вес пункта.
    let percent =
      deduction.severity !== undefined
        ? Math.round(requirement.weight * deduction.severity)
        : deduction.state === 'partial'
          ? Math.round(requirement.weight / 2)
          : deduction.state === 'missing'
            ? requirement.weight
            : (deduction.percent ?? requirement.weight);
    percent = Math.max(1, Math.min(requirement.weight, percent));
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

  // Скачанный кадр не засчитывается, даже если всё формально «видно»:
  // смысл заданий в том, чтобы человек снял это сам. Если модель сама не
  // уверена, это не «downloaded», а «suspicious» — не обнуляем честное фото.
  const downloaded = raw.source === 'downloaded' && raw.confidence >= 0.6;
  if (downloaded) {
    return {
      score: INVALID_SCORE,
      verdict: 'fail',
      reason: raw.sourceNote ?? SOURCE_DOWNLOADED_REASON,
      confidence: raw.confidence,
      deductions: [
        { kind: 'origin' as const, label: 'кадр скачан из интернета, а не снят самим', percent: 100 },
      ],
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

  // Не видно ни одного обязательного пункта — снимок не про задание. Не
  // оставляем проценты «за то, что осталось»: сумма весов может быть меньше
  // 100, и посторонний кадр получал бы 10–15% просто по арифметике.
  // Считаем по состоянию, а не по процентам: severity у таких пунктов может
  // быть меньше полного веса.
  const fullyMissing = new Set<string>();
  for (const item of raw.deductions) {
    if (!item.id) continue;
    const requirement = task.rubric.required.find((entry) => entry.id === item.id);
    if (!requirement) continue;
    if (
      item.state === 'missing' ||
      (item.state === undefined && (item.percent ?? 0) >= requirement.weight)
    ) {
      fullyMissing.add(item.id);
    }
  }
  const missesEverything =
    task.rubric.required.length > 0 &&
    task.rubric.required.every((requirement) => fullyMissing.has(requirement.id));

  // Показываем одну понятную причину вместо списка из пяти пунктов: при
  // полностью постороннем кадре детализация ничего не объясняет.
  const finalDeductions: AiDeduction[] = missesEverything
    ? [{ label: 'фото не относится к заданию: не видно ни одной обязательной детали', percent: 100 }]
    : [...deductions];

  // Кадр не пойман на прямой улике, но выглядит стоковым: полного балла за
  // скачанную картинку быть не должно, при этом честное фото всё равно пройдёт.
  const doubtfulOrigin =
    raw.source === 'suspicious' || (raw.source === 'downloaded' && !downloaded);
  if (!missesEverything && doubtfulOrigin) {
    finalDeductions.push({
      kind: 'origin' as const,
      label: 'кадр похож на скачанный из интернета: в нём нет живых деталей места и момента',
      percent: SOURCE_PENALTY,
    });
  }

  const total = finalDeductions.reduce((sum, item) => sum + item.percent, 0);
  // Сомнение в оригинальности снижает баллы, но не проваливает кадр, который
  // прошёл по содержанию: его можно оправдать вторым снимком с другого ракурса.
  const contentTotal = finalDeductions.reduce(
    (sum, item) => (item.kind === 'origin' ? sum : sum + item.percent),
    0,
  );
  const score = missesEverything ? 0 : Math.max(0, Math.min(100, 100 - total));
  const passed = !missesEverything && 100 - contentTotal >= PASS_SCORE;

  return {
    score,
    verdict: passed ? 'pass' : 'fail',
    reason: raw.reason,
    confidence: raw.confidence,
    deductions: finalDeductions,
  };
}

async function askModel(
  env: Env,
  model: string,
  prompt: string,
  images: string[],
): Promise<string> {
  const result = await env.AI.run(model, {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      },
    ],
    max_tokens: 700,
    temperature: 0.1,
  });
  return extractText(result).trim();
}

/** Один кадр для обычной проверки или два — для доказательства оригинальности. */
async function runVision(
  env: Env,
  prompt: string,
  image: string | string[],
): Promise<string> {
  const images = Array.isArray(image) ? image : [image];
  const models = [
    env.AI_MODEL || '@cf/meta/llama-4-scout-17b-16e-instruct',
    env.AI_FALLBACK_MODEL || '@cf/meta/llama-3.2-11b-vision-instruct',
  ];

  let lastError: unknown = null;
  for (const model of models) {
    try {
      const text = await askModel(env, model, prompt, images);
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

interface AppealAnswer {
  /** Сколько процентных пунктов штрафа вернуть. */
  reduce?: number;
  /** Резервный формат, если модель ответила состояниями. */
  state?: CheckState;
}

/**
 * Разбирает ответ на апелляцию. Главное поле — reduce: любое целое от 0
 * до текущего штрафа, а не только «снять всё» или «оставить половину».
 */
function parseAppealResponse(text: string): {
  answers: Map<string, AppealAnswer>;
  reason: string | null;
} {
  const answers = new Map<string, AppealAnswer>();
  let reason: string | null = null;
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return { answers, reason };

  try {
    const raw = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    // Ответ на апелляцию развёрнутый: модель объясняет позицию по каждому
    // замечанию, поэтому лимит выше, чем у короткой похвалы.
    if (typeof raw.reason === 'string') reason = raw.reason.slice(0, 900).trim() || null;
    if (!Array.isArray(raw.checks)) return { answers, reason };

    for (const entry of raw.checks) {
      if (!entry || typeof entry !== 'object') continue;
      const value = entry as Record<string, unknown>;
      const id = typeof value.id === 'string' ? value.id.trim() : '';
      if (!id) continue;

      const rawReduce = Number(value.reduce ?? value.refund ?? value.relief);
      const reduce = Number.isFinite(rawReduce) ? Math.round(rawReduce) : undefined;

      const stateRaw = typeof value.state === 'string' ? value.state.toLowerCase() : '';
      const state: CheckState | null =
        stateRaw === 'ok' || stateRaw === 'visible' || stateRaw === 'done'
          ? 'ok'
          : stateRaw === 'partial' || stateRaw === 'частично'
            ? 'partial'
            : stateRaw === 'missing' || stateRaw === 'нет' || stateRaw === 'отсутствует'
              ? 'missing'
              : null;

      if (reduce === undefined && !state) continue;
      answers.set(id, { reduce, state: state ?? undefined });
    }
  } catch {
    // Битый ответ — ниже сработает гарантированный минимум.
  }

  return { answers, reason };
}

type AppealRecheckState = 'ok' | 'partial' | 'no';

/** Узкий ответ перепроверки: подтверждает ли кадр довод человека. */
function parseAppealRecheck(text: string): Map<string, AppealRecheckState> {
  const answers = new Map<string, AppealRecheckState>();
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return answers;

  try {
    const raw = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    if (!Array.isArray(raw.checks)) return answers;

    for (const entry of raw.checks) {
      if (!entry || typeof entry !== 'object') continue;
      const value = entry as Record<string, unknown>;
      const id = typeof value.id === 'string' ? value.id.trim() : '';
      const state = typeof value.state === 'string' ? value.state.toLowerCase() : '';
      if (!id) continue;
      if (state === 'ok' || state === 'yes' || state === 'visible') answers.set(id, 'ok');
      else if (state === 'partial' || state === 'частично') answers.set(id, 'partial');
      else if (state === 'no' || state === 'missing' || state === 'нет') answers.set(id, 'no');
    }
  } catch {
    // Битый ответ — останется минимальный возврат.
  }

  return answers;
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
      return {
        id: item.id,
        label: requirement?.label ?? item.label,
        // Сохраняем выбранную моделью тяжесть минуса: перепроверка меняет
        // только state, а не сглаживает штраф до полного или половинного веса.
        severity: requirement
          ? Math.max(0.05, Math.min(1, item.percent / requirement.weight))
          : undefined,
      };
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
      const severity =
        state === 'partial' && claim.severity !== undefined
          ? Math.min(claim.severity, 0.55)
          : claim.severity;
      verified.push({ id: claim.id, state, severity });
    }
    return { deductions: verified, reason };
  } catch {
    return null;
  }
}

/** Даже при полном несогласии ИИ каждый минус уменьшается хотя бы на 1%. */
const APPEAL_MIN_PER_ITEM = 1;

export type AppealApplied = 'full' | 'partial' | 'minimum';

export interface AppealOutcome extends AiVerdict {
  /** Сколько процентов удалось вернуть. */
  relieved: number;
  /** full — все минусы сняты, partial — часть, minimum — ИИ не согласился. */
  applied: AppealApplied;
}

function totalPercent(items: AiDeduction[]): number {
  return items.reduce((sum, item) => sum + item.percent, 0);
}

/**
 * Апелляция: человек просит пересмотреть все минусы разом. По каждому пункту
 * модель возвращает reduce — сколько процентных пунктов вернуть. Это может быть
 * любое число от 0 до текущего штрафа: не только «снять всё» или «половину».
 * Новые минусы и рост штрафа невозможны, а каждый минус уменьшается хотя бы на
 * 1% — единственная попытка не должна сгорать впустую.
 */
export async function appealVerdict(
  env: Env,
  task: Task,
  image: string,
  current: AiDeduction[],
  note: string,
): Promise<AppealOutcome> {
  const claims: AppealClaim[] = current.map((item, index) => ({
    id: item.id ?? `item-${index}`,
    label: item.label,
    percent: item.percent,
  }));

  const { answers, reason } = parseAppealResponse(
    await runVision(env, buildAppealPrompt(task, claims, note), image),
  );

  // Сколько вернул первый проход по каждому пункту.
  const reliefs = current.map((item, index) => {
    const answer = answers.get(claims[index].id);
    let relief = 0;
    if (answer?.reduce !== undefined) {
      relief = answer.reduce;
    } else if (answer?.state === 'ok') {
      relief = item.percent;
    } else if (answer?.state === 'partial') {
      relief = Math.max(1, Math.round(item.percent / 2));
    }
    // Модель не может вернуть больше, чем было списано, или уйти в минус.
    return Math.max(0, Math.min(item.percent, relief));
  });

  // Первый проход отказал хотя бы по одному пункту — перечитываем только эти
  // пункты узким вопросом: подтверждает ли кадр довод человека. Иначе честная
  // апелляция упирается в гарантированный 1%.
  const refused = current
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => reliefs[index] < APPEAL_MIN_PER_ITEM);
  if (refused.length > 0) {
    try {
      const rechecked = parseAppealRecheck(
        await runVision(
          env,
          buildAppealRecheckPrompt(
            task,
            refused.map(({ index }) => claims[index]),
            note,
          ),
          image,
        ),
      );
      for (const { item, index } of refused) {
        const state = rechecked.get(claims[index].id);
        if (state === 'ok') {
          reliefs[index] = item.percent;
        } else if (state === 'partial') {
          reliefs[index] = Math.max(1, Math.round(item.percent / 2));
        }
      }
    } catch {
      // Перепроверка не удалась — оставляем результат первого прохода.
    }
  }

  let modelRelief = 0;
  const reduced: AiDeduction[] = [];
  current.forEach((item, index) => {
    let relief = reliefs[index];
    modelRelief += relief;

    // Даже если ИИ не согласен, каждый оставшийся минус уменьшается на 1%:
    // штраф не должен остаться нетронутым ни по одному замечанию.
    if (relief < APPEAL_MIN_PER_ITEM) {
      relief = Math.min(item.percent, APPEAL_MIN_PER_ITEM);
    }

    const percent = item.percent - relief;
    if (percent > 0) reduced.push({ ...item, percent });
  });

  const before = totalPercent(current);
  const next = reduced;
  const after = totalPercent(next);
  const applied: AppealApplied =
    after === 0 ? 'full' : modelRelief > 0 ? 'partial' : 'minimum';

  const score = Math.max(0, Math.min(100, 100 - after));
  const fallback =
    applied === 'full'
      ? 'Спасибо за пояснение — замечания сняты, баллы восстановлены.'
      : applied === 'partial'
        ? 'Спасибо за пояснение — часть замечаний снята, оценка стала выше.'
        : 'Спасибо за пояснение. Полностью снять замечание не удалось, но я уменьшил штраф.';

  return {
    score,
    verdict: score >= PASS_SCORE ? 'pass' : 'fail',
    reason: reason ?? fallback,
    confidence: 0.75,
    deductions: next,
    relieved: before - after,
    applied,
  };
}

export interface ProofOutcome {
  /** Минус за сомнение можно снять. */
  accepted: boolean;
  reason: string;
  sameScene: 'yes' | 'partial' | 'no';
  freshAngle: boolean;
  sameImage: boolean;
  source: RawSource;
}

function parseProof(text: string): ProofOutcome | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    const raw = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const sceneRaw = typeof raw.same_scene === 'string' ? raw.same_scene.toLowerCase() : '';
    const sameScene = sceneRaw === 'yes' || sceneRaw === 'partial' || sceneRaw === 'no'
      ? sceneRaw
      : null;
    if (!sameScene) return null;

    const reason = typeof raw.reason === 'string' ? raw.reason.slice(0, 400).trim() : '';
    if (!reason) return null;

    const freshAngle = raw.fresh_angle === true;
    const sameImage = raw.same_image === true;
    const sourceRaw = typeof raw.source === 'string' ? raw.source.toLowerCase() : '';
    const source: RawSource =
      sourceRaw === 'downloaded' ? 'downloaded' : sourceRaw === 'suspicious' ? 'suspicious' : 'own';

    // Доказательство принимается только когда это тот же объект, снятый заново
    // с другой точки, и второй кадр не является копией первого.
    const accepted = sameScene === 'yes' && freshAngle && !sameImage && source !== 'downloaded';

    return { accepted, reason, sameScene, freshAngle, sameImage, source };
  } catch {
    return null;
  }
}

/**
 * Сравнение основного кадра с доказательством: та же ли это сцена, снятая
 * заново с другого ракурса. Ошибка модели не снимает и не подтверждает минус —
 * вызывающий код вернёт ошибку, и попытка не сгорит.
 */
export async function proveOriginality(
  env: Env,
  task: Task,
  images: string[],
): Promise<ProofOutcome> {
  const outcome = parseProof(await runVision(env, buildProofPrompt(task), images));
  if (!outcome) throw new Error('ai_invalid_response');
  return outcome;
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
        // Похвалу оставляем из первого прохода: перепроверка говорит о минусах,
        // и её служебный текст не должен попадать в карточку вместо похвалы.
      };
      verdict = buildVerdict(task, raw);
    }
  }

  return verdict;
}
