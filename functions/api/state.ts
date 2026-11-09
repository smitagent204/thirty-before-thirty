import { authenticate, json, loadState, type Ctx } from './_shared';

export const onRequestGet = async ({ request, env }: Ctx): Promise<Response> => {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;

  try {
    const state = await loadState(env, auth.user.id);
    return json({ ...state, isOwner: auth.isOwner });
  } catch {
    return json({ error: 'db_unavailable' }, 500);
  }
};
