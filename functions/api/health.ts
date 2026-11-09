import { json, type Ctx } from './_shared';

/** Публичная проверка конфигурации: не отдаёт секреты, только наличие биндингов. */
export const onRequestGet = async ({ env }: Ctx): Promise<Response> =>
  json({
    ok: true,
    db: Boolean(env.DB),
    ai: Boolean(env.AI),
    telegram: Boolean(env.TELEGRAM_BOT_TOKEN),
    pin: Boolean(env.MANUAL_PIN),
    owner: Boolean(env.OWNER_TELEGRAM_ID),
  });
