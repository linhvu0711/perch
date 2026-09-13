import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { TagList } from '@perch/core';

import { createTestServer, type TestServer } from '../src/testing';

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

afterEach(() => {
  server.cleanup();
});

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${server.token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  return server.app.request(path, { ...init, headers });
}

describe('tags', () => {
  test('creates a tag and lists it with zero counts', async () => {
    const created = await request('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ name: ' writing ' }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      id: 1,
      name: 'writing',
      resource_count: 0,
      post_count: 0,
    });

    const list = await request('/api/tags');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({
      items: [{ id: 1, name: 'writing', resource_count: 0, post_count: 0 }],
      total: 1,
      next_cursor: null,
    });
  });

  test('rejects a name that differs only in case', async () => {
    await request('/api/tags', { method: 'POST', body: JSON.stringify({ name: 'writing' }) });

    const dupe = await request('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ name: 'Writing' }),
    });
    expect(dupe.status).toBe(400);
    expect(await dupe.json()).toMatchObject({
      code: 'validation',
      errors: [{ path: 'name', message: 'Tag "Writing" already exists' }],
    });

    const list = (await (await request('/api/tags')).json()) as TagList;
    expect(list.total).toBe(1);
  });

  test('rejects an empty or too long name', async () => {
    const empty = await request('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ name: '  ' }),
    });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({
      code: 'validation',
      errors: [{ path: 'name' }],
    });

    const long = await request('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ name: 'x'.repeat(51) }),
    });
    expect(long.status).toBe(400);
    expect(await long.json()).toMatchObject({
      code: 'validation',
      errors: [{ path: 'name' }],
    });
  });

  test('requires authentication', async () => {
    const response = await server.app.request('/api/tags');
    expect(response.status).toBe(401);
  });
});
