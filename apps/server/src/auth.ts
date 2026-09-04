import { timingSafeEqual } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';
import type { CookieOptions } from 'hono/utils/cookie';

import { ApiError } from './errors';

export const COOKIE_NAME = 'perch_session';
export const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface User {
  id: number;
}

type AuthEnv = { Variables: { user: User } };

const USER_ONE: User = { id: 1 };

export function timingSafeEqualStrings(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return (
    left.length === right.length &&
    timingSafeEqual(
      left as unknown as Uint8Array<ArrayBuffer>,
      right as unknown as Uint8Array<ArrayBuffer>,
    )
  );
}

function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    let value = part.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return undefined;
}

export function getUser(request: Request, token: string): User | null {
  const authorization = request.headers.get('Authorization');
  const bearer = authorization?.match(/^Bearer (.+)$/i);
  if (bearer) {
    return timingSafeEqualStrings(bearer[1] ?? '', token) ? USER_ONE : null;
  }

  const cookie = readCookie(request, COOKIE_NAME);
  if (cookie === undefined) return null;
  return timingSafeEqualStrings(cookie, token) ? USER_ONE : null;
}

export function authMiddleware(token: string): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    if (
      c.req.path === '/api/auth/login' ||
      c.req.path === '/api/auth/logout'
    ) {
      await next();
      return;
    }

    const user = getUser(c.req.raw, token);
    if (!user) {
      throw new ApiError(401, 'unauthorized', 'Missing or invalid token');
    }

    c.set('user', user);
    await next();
  };
}

export function sessionCookieOptions(request: Request): CookieOptions {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: new URL(request.url).protocol === 'https:',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}
