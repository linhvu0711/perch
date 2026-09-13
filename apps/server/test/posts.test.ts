import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Post, Resource } from '@perch/core';

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

async function createPost(input: Record<string, unknown>): Promise<Post> {
  const response = await request('/api/posts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Post;
}

async function createNote(body: string): Promise<Resource> {
  const response = await request('/api/resources/notes', {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Resource;
}

describe('posts', () => {
  test('creates a draft and gets it with count, limit, Cost, links, and empty media', async () => {
    await createNote('# Idea\n\ntext');

    const created = await request('/api/posts', {
      method: 'POST',
      body: JSON.stringify({ title: 'Hi', text: 'Hello world', from: [1] }),
    });
    expect(created.status).toBe(201);
    const expected = {
      id: 1,
      status: 'draft',
      title: 'Hi',
      text: 'Hello world',
      scheduled_at: null,
      published_at: null,
      x_account_id: null,
      x_post_id: null,
      last_error: null,
      retry_count: 0,
      created_at: '2026-09-04T10:00:00.000Z',
      updated_at: '2026-09-04T10:00:00.000Z',
      character_count: 11,
      limit: 280,
      estimated_cost: 0.015,
      links: [{ resource_id: 1, type: 'md', title: 'Idea' }],
      media: [],
    };
    expect(await created.json()).toEqual(expected);

    const got = await request('/api/posts/1');
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual(expected);

    const empty = await createPost({});
    expect(empty).toMatchObject({
      title: '',
      text: '',
      character_count: 0,
      links: [],
    });

    const withUrl = await createPost({ text: 'see https://x.com' });
    expect(withUrl.character_count).toBe(27);
    expect(withUrl.estimated_cost).toBe(0.2);

    const missing = await request('/api/posts', {
      method: 'POST',
      body: JSON.stringify({ from: [999] }),
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'from', message: 'Resource 999 not found' }],
    });

    const missingGet = await request('/api/posts/999');
    expect(missingGet.status).toBe(404);
    expect(await missingGet.json()).toEqual({
      code: 'not_found',
      message: 'Post 999 not found',
    });

    const badId = await request('/api/posts/abc');
    expect(badId.status).toBe(400);
  });

  test('reads the limit from settings', async () => {
    const patched = await request('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ char_limit_override: 25000 }),
    });
    expect(patched.status).toBe(200);

    await createPost({ text: 'x' });

    const got = await request('/api/posts/1');
    expect(got.status).toBe(200);
    expect((await got.json()).limit).toBe(25000);
  });
});
