import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';

import { ApiError, DomainError, errorHandler } from '../src/errors';

const app = new Hono().onError(errorHandler);
app.get('/boom', () => {
  throw new Error('boom');
});
app.get('/status', () => {
  throw new DomainError('invalid_status', 'status', 'Post 1 is published');
});
app.get('/account', () => {
  throw new DomainError('not_found', null, 'No X account connected');
});
app.get('/refresh', () => {
  throw new DomainError('token_refresh_failed', null, 'X token refresh failed');
});
app.get('/auth', () => {
  throw new ApiError(401, 'unauthorized', 'Missing or invalid token');
});

describe('errorHandler', () => {
  test('answers 500 with the documented body for a plain Error', async () => {
    // When
    const res = await app.request('/boom');
    // Then
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: 'internal', message: 'Internal error' });
  });

  test('maps a DomainError with a path to the validation envelope', async () => {
    // When
    const res = await app.request('/status');
    // Then
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'status', message: 'Post 1 is published' }],
    });
  });

  test('maps a DomainError without a path to its status and code', async () => {
    // When
    const account = await app.request('/account');
    const refresh = await app.request('/refresh');
    // Then
    expect(account.status).toBe(404);
    expect(await account.json()).toEqual({ code: 'not_found', message: 'No X account connected' });
    expect(refresh.status).toBe(503);
    expect(await refresh.json()).toEqual({
      code: 'token_refresh_failed',
      message: 'X token refresh failed',
    });
  });

  test('keeps ApiError as it is', async () => {
    // When
    const res = await app.request('/auth');
    // Then
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'unauthorized', message: 'Missing or invalid token' });
  });
});
