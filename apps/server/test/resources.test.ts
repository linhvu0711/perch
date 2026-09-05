import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Resource, ResourceList } from '@perch/core';

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

async function create(input: Record<string, unknown>): Promise<Resource> {
  const response = await request('/api/resources/notes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Resource;
}

async function list(query = ''): Promise<ResourceList> {
  const response = await request(`/api/resources${query}`);
  expect(response.status).toBe(200);
  return (await response.json()) as ResourceList;
}

describe('resources', () => {
  test('creates notes and derives titles', async () => {
    const helloResponse = await request('/api/resources/notes', {
      method: 'POST',
      body: JSON.stringify({ body: '# Hello\n\ntext' }),
    });
    expect(helloResponse.status).toBe(201);
    expect(await helloResponse.json()).toEqual({
      id: 1,
      title: 'Hello',
      notes: '',
      created_at: '2026-09-04T10:00:00.000Z',
      type: 'md',
      body: '# Hello\n\ntext',
    });

    expect((await create({ body: 'no heading' })).title).toBe('Untitled');
    expect((await create({ title: 'Given', body: '# H' })).title).toBe('Given');
    expect((await create({ title: '', body: '# H' })).title).toBe('H');

    const invalid = await request('/api/resources/notes', {
      method: 'POST',
      body: '{}',
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      code: 'validation',
      errors: [{ path: 'body' }],
    });
  });

  test('gets notes and reports invalid or missing ids', async () => {
    const resource = await create({ body: '# Hello' });

    const found = await request(`/api/resources/${resource.id}`);
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual(resource);

    const missing = await request('/api/resources/999');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      code: 'not_found',
      message: 'Resource 999 not found',
    });

    const invalid = await request('/api/resources/abc');
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      code: 'validation',
      errors: [{ path: 'id' }],
    });
  });

  test('patches title, notes, and body', async () => {
    const resource = await create({ body: '# Original' });
    const patch = async (body: Record<string, unknown>) => {
      const response = await request(`/api/resources/${resource.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      const followUp = await request(`/api/resources/${resource.id}`);
      expect(followUp.status).toBe(200);
      return (await followUp.json()) as Resource;
    };

    expect((await patch({ title: 'Changed' })).title).toBe('Changed');
    expect((await patch({ notes: 'Private' })).notes).toBe('Private');
    expect((await patch({ body: 'New body' })).body).toBe('New body');
    expect(
      await patch({ title: 'Together', notes: 'N', body: 'Everything' }),
    ).toMatchObject({ title: 'Together', notes: 'N', body: 'Everything' });

    const empty = await request(`/api/resources/${resource.id}`, {
      method: 'PATCH',
      body: '{}',
    });
    expect(empty.status).toBe(400);

    const emptyTitle = await request(`/api/resources/${resource.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: '' }),
    });
    expect(emptyTitle.status).toBe(400);

    const missing = await request('/api/resources/999', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Nope' }),
    });
    expect(missing.status).toBe(404);
  });

  test('lists, filters, searches, sorts, and validates cursors and limits', async () => {
    const a = await create({ body: '# Alpha\n\nbanana' });
    const b = await create({ body: '# Beta' });
    const c = await create({ title: 'Gamma', body: 'plain' });

    expect((await list()).items.map((item) => item.id)).toEqual([c.id, b.id, a.id]);
    expect((await list('?order=asc')).items.map((item) => item.id)).toEqual([
      a.id,
      b.id,
      c.id,
    ]);
    expect((await list('?search=banana')).items.map((item) => item.id)).toEqual([a.id]);
    expect((await list('?search=BETA')).items.map((item) => item.id)).toEqual([b.id]);
    expect((await list('?search=%25')).items).toEqual([]);
    expect((await list('?type=md')).items).toHaveLength(3);
    expect(await list('?type=tweet')).toMatchObject({ items: [], total: 0 });

    const firstPage = await list('?limit=2');
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.total).toBe(3);
    expect(firstPage.next_cursor).not.toBeNull();

    const badCursor = await request('/api/resources?cursor=garbage');
    expect(badCursor.status).toBe(400);
    expect(await badCursor.json()).toMatchObject({
      code: 'validation',
      errors: [{ path: 'cursor', message: 'Invalid cursor' }],
    });

    const badLimit = await request('/api/resources?limit=101');
    expect(badLimit.status).toBe(400);
  });

  test('keeps descending and ascending cursor walks stable across inserts', async () => {
    for (let id = 1; id <= 5; id += 1) await create({ body: `# ${id}` });

    const desc1 = await list('?limit=2&order=desc');
    expect(desc1.items.map((item) => item.id)).toEqual([5, 4]);
    expect(desc1.next_cursor).not.toBeNull();
    await create({ body: '# 6' });
    const desc2 = await list(`?limit=2&order=desc&cursor=${desc1.next_cursor}`);
    expect(desc2.items.map((item) => item.id)).toEqual([3, 2]);
    const desc3 = await list(`?limit=2&order=desc&cursor=${desc2.next_cursor}`);
    expect(desc3.items.map((item) => item.id)).toEqual([1]);
    expect(desc3.next_cursor).toBeNull();

    const asc1 = await list('?limit=2&order=asc');
    expect(asc1.items.map((item) => item.id)).toEqual([1, 2]);
    await create({ body: '# 7' });
    const asc2 = await list(`?limit=2&order=asc&cursor=${asc1.next_cursor}`);
    expect(asc2.items.map((item) => item.id)).toEqual([3, 4]);
    const asc3 = await list(`?limit=2&order=asc&cursor=${asc2.next_cursor}`);
    expect(asc3.items.map((item) => item.id)).toEqual([5, 6]);
    const asc4 = await list(`?limit=2&order=asc&cursor=${asc3.next_cursor}`);
    expect(asc4.items.map((item) => item.id)).toEqual([7]);
    expect(asc4.next_cursor).toBeNull();
  });

  test('deletes resources with per-item results', async () => {
    await create({ body: '# One' });
    await create({ body: '# Two' });

    const mixed = await request('/api/resources', {
      method: 'DELETE',
      body: JSON.stringify({ ids: [1, 999, 2] }),
    });
    expect(mixed.status).toBe(200);
    expect(await mixed.json()).toEqual({
      results: [
        { id: 1, ok: true, unlinked_post_ids: [] },
        {
          id: 999,
          ok: false,
          error: { code: 'not_found', message: 'Resource 999 not found' },
        },
        { id: 2, ok: true, unlinked_post_ids: [] },
      ],
    });
    expect((await request('/api/resources/1')).status).toBe(404);

    const allMissing = await request('/api/resources', {
      method: 'DELETE',
      body: JSON.stringify({ ids: [999] }),
    });
    expect(allMissing.status).toBe(200);
    expect(await allMissing.json()).toMatchObject({
      results: [{ id: 999, ok: false, error: { code: 'not_found' } }],
    });

    const empty = await request('/api/resources', {
      method: 'DELETE',
      body: JSON.stringify({ ids: [] }),
    });
    expect(empty.status).toBe(400);
  });

  test('requires authentication', async () => {
    const response = await server.app.request('/api/resources');
    expect(response.status).toBe(401);
  });
});
