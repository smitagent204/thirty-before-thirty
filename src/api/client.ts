import type { AiDeduction } from '@shared/types';

export interface ServerState {
  completed: string[];
  manualCompleted: string[];
  chestOpened: boolean;
  isOwner: boolean;
}

export interface CheckResult {
  pass: boolean;
  score: number;
  verdict: 'pass' | 'fail';
  reason: string;
  confidence: number;
  completed?: boolean;
  points?: number;
  /** Повторная проверка уже засчитанного задания. */
  recheck?: boolean;
  /** Новый кадр сохранён (при повторной проверке — только если стал лучше). */
  saved?: boolean;
  previousScore?: number | null;
  /** Понятный список того, чего не хватило: id, подпись и процент. */
  deductions?: AiDeduction[];
}

export interface RecheckResult {
  taskId: string;
  title: string;
  oldScore: number;
  newScore: number;
  oldVerdict: string;
  verdict: string;
  reason: string;
  deductions: AiDeduction[];
  improved: boolean;
  /** Новый прогон оказался ниже порога — оставили прежнюю принятую оценку. */
  kept?: boolean;
  candidateReason?: string;
  candidateDeductions?: AiDeduction[];
  /** Переоценка ухудшила оспоренное фото — апелляцию можно подать заново. */
  appealReset?: boolean;
}

export interface DismissResult {
  taskId: string;
  title: string;
  score: number;
  verdict: string;
  reason: string;
  deductions: AiDeduction[];
}

export interface ManualResult extends ServerState {
  points?: number;
}

export interface PrizeResult {
  image: string;
}

export interface WifeState {
  completed: string[];
  manualCompleted: string[];
  chestOpened: boolean;
  configured: boolean;
}

export interface PhotoResult {
  image: string;
  score: number;
  verdict: string;
  reason?: string;
  deductions?: AiDeduction[];
  confidence: number;
  /** Когда фото оспорили; null — апелляция ещё доступна. */
  appealedAt?: string | null;
  /** Оценка до апелляции. */
  appealScoreBefore?: number | null;
  /** Пояснение человека из апелляции. */
  appealText?: string | null;
  /** Минусы, которые были до пересмотра. */
  appealDeductions?: AiDeduction[];
  /** Что ИИ ответил на апелляцию. */
  appealReason?: string | null;
  createdAt: string;
}

export interface AppealResult {
  taskId: string;
  title: string;
  scoreBefore: number;
  score: number;
  verdict: string;
  /** Исходная похвала — она не меняется после апелляции. */
  reason: string;
  deductions: AiDeduction[];
  /** Ответ ИИ на апелляцию — показывается отдельно. */
  appealReason: string;
  appealText: string;
  /** Минусы до пересмотра. */
  appealDeductions: AiDeduction[];
  /** Сколько процентов удалось вернуть. */
  relieved: number;
  applied: 'full' | 'partial' | 'minimum';
  appealedAt: string;
}

export interface WifeTaskState {
  completed: boolean;
  manual: boolean;
  createdAt: string | null;
  photo: PhotoResult | null;
}

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function getInitData(): string {
  if (typeof window === 'undefined') return '';
  return window.Telegram?.WebApp?.initData ?? '';
}

export function hasTelegramAuth(): boolean {
  return getInitData().length > 0;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const initData = getInitData();
  if (initData) headers.set('X-Telegram-Init-Data', initData);
  if (init.body) headers.set('content-type', 'application/json');

  const response = await fetch(path, {
    ...init,
    headers,
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof payload.error === 'string' ? payload.error : 'http_error',
    );
  }
  return payload as T;
}

export const api = {
  state: () => request<ServerState>('/api/state'),

  check: (taskId: string, image: string, forceFail = false) =>
    request<CheckResult>(`/api/tasks/${encodeURIComponent(taskId)}/check`, {
      method: 'POST',
      body: JSON.stringify({ image, forceFail }),
    }),

  manual: (taskId: string, pin: string) =>
    request<ManualResult>(`/api/tasks/${encodeURIComponent(taskId)}/manual`, {
      method: 'POST',
      body: JSON.stringify({ pin }),
    }),

  openChest: () => request<ServerState>('/api/chest/open', { method: 'POST' }),

  prize: () => request<PrizeResult>('/api/prize'),

  dev: (action: string, body?: unknown) =>
    request<ServerState>(`/api/dev/${encodeURIComponent(action)}`, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),

  wife: () => request<WifeState>('/api/dev/wife', { method: 'POST' }),

  wifeTask: (taskId: string) =>
    request<WifeTaskState>('/api/dev/wife-task', {
      method: 'POST',
      body: JSON.stringify({ taskId }),
    }),

  recheckWifeTask: (taskId: string) =>
    request<RecheckResult>('/api/dev/recheck-wife-task', {
      method: 'POST',
      body: JSON.stringify({ taskId }),
    }),

  dismissWifeDeduction: (taskId: string, deductionId: string) =>
    request<DismissResult>('/api/dev/dismiss-wife-deduction', {
      method: 'POST',
      body: JSON.stringify({ taskId, deductionId }),
    }),

  photo: (taskId: string) =>
    request<PhotoResult>(`/api/tasks/${encodeURIComponent(taskId)}/photo`),

  appeal: (taskId: string, text: string) =>
    request<AppealResult>(`/api/tasks/${encodeURIComponent(taskId)}/appeal`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
};
