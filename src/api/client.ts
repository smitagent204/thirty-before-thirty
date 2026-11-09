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
}

export interface ManualResult extends ServerState {
  points?: number;
}

export interface PrizeResult {
  image: string;
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
};
