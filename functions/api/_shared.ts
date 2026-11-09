/* Общие хелперы Pages Functions: типы, ответы, проверка Telegram initData. */

export interface D1Result<T> {
  results: T[];
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface Env {
  DB: D1Database;
  AI: AiBinding;
  TELEGRAM_BOT_TOKEN?: string;
  MANUAL_PIN?: string;
  OWNER_TELEGRAM_ID?: string;
  USER_TELEGRAM_ID?: string;
  ALLOWED_TELEGRAM_IDS?: string;
  AI_MODEL?: string;
  AI_FALLBACK_MODEL?: string;
}

export interface Ctx {
  request: Request;
  env: Env;
  params: Record<string, string>;
}

export interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
}

export interface AuthResult {
  user: TgUser;
  isOwner: boolean;
}

export interface UserState {
  completed: string[];
  manualCompleted: string[];
  chestOpened: boolean;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Проверяет подпись Telegram WebApp initData.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export async function authenticate(
  request: Request,
  env: Env,
): Promise<AuthResult | Response> {
  const initData = request.headers.get('X-Telegram-Init-Data') ?? '';
  if (!initData) return json({ error: 'unauthorized' }, 401);
  if (!env.TELEGRAM_BOT_TOKEN) return json({ error: 'server_not_configured' }, 500);

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return json({ error: 'unauthorized' }, 401);

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const secret = await crypto.subtle.sign(
    'HMAC',
    secretKey,
    encoder.encode(env.TELEGRAM_BOT_TOKEN),
  );
  const signKey = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    signKey,
    encoder.encode(dataCheckString),
  );

  if (!timingSafeEqual(hex(signature), hash)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const authDate = Number(params.get('auth_date'));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate) || now - authDate > 86_400) {
    return json({ error: 'init_data_expired' }, 401);
  }

  let user: TgUser;
  try {
    user = JSON.parse(params.get('user') ?? '') as TgUser;
  } catch {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!user || typeof user.id !== 'number') {
    return json({ error: 'unauthorized' }, 401);
  }

  const owner = env.OWNER_TELEGRAM_ID ? String(env.OWNER_TELEGRAM_ID) : '';
  const isOwner = owner !== '' && String(user.id) === owner;

  const allowed = new Set(
    (env.ALLOWED_TELEGRAM_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (env.USER_TELEGRAM_ID) allowed.add(String(env.USER_TELEGRAM_ID));
  if (owner) allowed.add(owner);

  if (!isOwner && !allowed.has(String(user.id))) {
    return json({ error: 'forbidden' }, 403);
  }

  return { user, isOwner };
}

export async function loadState(env: Env, telegramId: number): Promise<UserState> {
  const rows = await env.DB.prepare(
    'SELECT task_id, manual FROM completions WHERE telegram_id = ? ORDER BY created_at',
  )
    .bind(telegramId)
    .all<{ task_id: string; manual: number }>();

  const state = await env.DB.prepare(
    'SELECT chest_opened FROM app_state WHERE telegram_id = ?',
  )
    .bind(telegramId)
    .first<{ chest_opened: number }>();

  return {
    completed: rows.results.map((row) => row.task_id),
    manualCompleted: rows.results
      .filter((row) => row.manual === 1)
      .map((row) => row.task_id),
    chestOpened: Boolean(state?.chest_opened),
  };
}

export { timingSafeEqual };
