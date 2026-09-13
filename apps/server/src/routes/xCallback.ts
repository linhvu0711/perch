import type { Context, Handler } from 'hono';

import type { AppDeps, AppEnv } from '../app';

export function xCallbackHandler(deps: AppDeps): Handler<AppEnv> {
  return async (c: Context<AppEnv>) => {
    const result = await deps.accounts.completeConnect({
      code: c.req.query('code'),
      state: c.req.query('state'),
      error: c.req.query('error'),
    });
    return c.redirect(
      result.ok ? '/settings?connected=1' : `/settings?connect_error=${result.reason}`,
      302,
    );
  };
}
