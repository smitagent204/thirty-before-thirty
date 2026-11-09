/**
 * Код ручного подтверждения задания.
 *
 * По умолчанию 300036. Чтобы поменять, создай .env.local:
 *   VITE_MANUAL_PIN=123456
 *
 * На этапе сервера проверка переедет в Cloudflare Worker (секрет),
 * и код перестанет попадать в бандл.
 */
const envPin =
  typeof import.meta !== 'undefined' && import.meta.env
    ? (import.meta.env.VITE_MANUAL_PIN as string | undefined)
    : undefined;

export const MANUAL_APPROVAL_PIN: string = envPin || '300036';

export const MANUAL_PIN_LENGTH = 6;
