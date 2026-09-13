import { zValidator } from '@hono/zod-validator';
import { loginBodySchema } from '@perch/core';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';

import type { AppDeps, AppEnv } from '../app';
import { COOKIE_NAME, sessionCookieOptions, userForSecret } from '../auth';
import { ApiError, validationHook } from '../errors';

export function authRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .post('/login', zValidator('json', loginBodySchema, validationHook), (c) => {
      const body = c.req.valid('json');
      const user = userForSecret(body.token, deps.token);
      if (!user) {
        throw new ApiError(401, 'unauthorized', 'Invalid token');
      }

      setCookie(c, COOKIE_NAME, deps.token, sessionCookieOptions(deps.secureCookies));
      return c.json({ user }, 200);
    })
    .post('/logout', (c) => {
      deleteCookie(c, COOKIE_NAME, { path: '/' });
      return c.json({ ok: true }, 200);
    })
    .get('/me', (c) => c.json({ user: c.get('user') }, 200));
}
