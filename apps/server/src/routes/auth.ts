import { loginBodySchema } from '@perch/core';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';

import type { AppDeps, AppEnv } from '../app';
import {
  COOKIE_NAME,
  sessionCookieOptions,
  timingSafeEqualStrings,
} from '../auth';
import { ApiError, validationHook } from '../errors';

export function authRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .post('/login', zValidator('json', loginBodySchema, validationHook), (c) => {
      const body = c.req.valid('json');
      if (!timingSafeEqualStrings(body.token, deps.token)) {
        throw new ApiError(401, 'unauthorized', 'Invalid token');
      }

      setCookie(
        c,
        COOKIE_NAME,
        deps.token,
        sessionCookieOptions(c.req.raw),
      );
      return c.json({ user: { id: 1 } }, 200);
    })
    .post('/logout', (c) => {
      deleteCookie(c, COOKIE_NAME, { path: '/' });
      return c.json({ ok: true }, 200);
    })
    .get('/me', (c) => c.json({ user: c.get('user') }, 200));
}
