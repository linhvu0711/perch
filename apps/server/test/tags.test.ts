import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ItemTagsResponse, TagList } from '@perch/core';

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

  test('adds and removes tags on resources in one batch', async () => {
    for (const body of ['# One', '# Two']) {
      const created = await request('/api/resources/notes', {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      expect(created.status).toBe(201);
    }

    const added = await request('/api/resources/tags', {
      method: 'POST',
      body: JSON.stringify({ ids: [1, 999, 2], tags: ['Writing', 'ideas'] }),
    });
    expect(added.status).toBe(200);
    expect(await added.json()).toEqual({
      results: [
        { id: 1, ok: true, tags: ['ideas', 'Writing'] },
        {
          id: 999,
          ok: false,
          error: { code: 'not_found', message: 'Resource 999 not found' },
        },
        { id: 2, ok: true, tags: ['ideas', 'Writing'] },
      ],
    });

    const removed = await request('/api/resources/tags', {
      method: 'DELETE',
      body: JSON.stringify({ ids: [1], tags: ['writing', 'nope'] }),
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({
      results: [{ id: 1, ok: true, tags: ['ideas'] }],
    });

    const first = await (await request('/api/resources/1')).json();
    expect(first.tags).toEqual(['ideas']);
    const second = await (await request('/api/resources/2')).json();
    expect(second.tags).toEqual(['ideas', 'Writing']);

    const list = (await (await request('/api/tags')).json()) as TagList;
    expect(list.items).toEqual([
      { id: 2, name: 'ideas', resource_count: 2, post_count: 0 },
      { id: 1, name: 'Writing', resource_count: 1, post_count: 0 },
    ]);
  });

  test('reuses a tag whose name differs only in case', async () => {
    await request('/api/resources/notes', {
      method: 'POST',
      body: JSON.stringify({ body: '# One' }),
    });
    await request('/api/tags', { method: 'POST', body: JSON.stringify({ name: 'writing' }) });

    const response = await request('/api/resources/tags', {
      method: 'POST',
      body: JSON.stringify({ ids: [1], tags: ['WRITING'] }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as ItemTagsResponse;
    expect(body.results[0]).toEqual({ id: 1, ok: true, tags: ['writing'] });

    const list = (await (await request('/api/tags')).json()) as TagList;
    expect(list.total).toBe(1);
  });

  test('rejects an empty batch', async () => {
    const noIds = await request('/api/resources/tags', {
      method: 'POST',
      body: JSON.stringify({ ids: [], tags: ['a'] }),
    });
    expect(noIds.status).toBe(400);
    expect(await noIds.json()).toMatchObject({ code: 'validation' });

    const noTags = await request('/api/resources/tags', {
      method: 'POST',
      body: JSON.stringify({ ids: [1], tags: [] }),
    });
    expect(noTags.status).toBe(400);
    expect(await noTags.json()).toMatchObject({ code: 'validation' });
  });
});
