import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';
import type { Post } from '@perch/core';
import { eq } from 'drizzle-orm';

import { openDb } from '../src/db';
import { posts } from '../src/db/schema';
import { XError } from '../src/x/client';
import {
  connectTestAccount,
  createTestServer,
  PNG_3X2,
  type TestServer,
} from '../src/testing';

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
  if (init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
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

async function getPost(id: number): Promise<Post> {
  const response = await request(`/api/posts/${id}`);
  expect(response.status).toBe(200);
  return (await response.json()) as Post;
}

function setPost(
  id: number,
  values: Partial<{
    status: 'draft' | 'official' | 'published' | 'failed';
    lastError: string | null;
    retryCount: number;
    scheduledAt: Date | null;
    publishedAt: Date | null;
  }>,
): void {
  const { db, sqlite } = openDb(path.join(server.dir, 'perch.db'));
  db.update(posts).set(values).where(eq(posts.id, id)).run();
  sqlite.close();
}

async function attachPng(postId: number): Promise<void> {
  const form = new FormData();
  form.append(
    'files',
    new File([PNG_3X2.slice().buffer as ArrayBuffer], 'a.png', { type: 'image/png' }),
  );
  const response = await request(`/api/posts/${postId}/media/files`, {
    method: 'POST',
    body: form,
  });
  expect(response.status).toBe(200);
}

async function monthCostUsd(): Promise<number> {
  const response = await request('/api/status');
  expect(response.status).toBe(200);
  return ((await response.json()) as { month_cost_usd: number }).month_cost_usd;
}

describe('publish', () => {
  test('publishes an official post: media first, then the post, ids stored, time cleared, $0.015 logged', async () => {
    // Given: a connected account and an official post with one image scheduled ahead
    connectTestAccount(server);
    await createPost({ text: 'Hello' });
    await attachPng(1);
    const promote = await request('/api/posts/promote', {
      method: 'POST',
      body: JSON.stringify({ ids: [1] }),
    });
    expect(promote.status).toBe(200);
    setPost(1, { scheduledAt: new Date('2026-09-10T09:00:00Z') });

    // When: publishing it now
    const response = await request('/api/posts/1/publish', { method: 'POST' });

    // Then: media uploaded before the post, ids stored, the schedule cleared, cost logged
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'published',
      x_post_id: '2',
      x_post_url: 'https://x.com/perchtester/status/2',
      x_account_id: 1,
      published_at: '2026-09-04T10:00:00.000Z',
      scheduled_at: null,
      last_error: null,
    });
    expect(server.xClient.calls.map((call) => call.name)).toEqual(['uploadMedia', 'createPost']);
    expect(server.xClient.calls[0]?.args[1]).toEqual({ bytes: PNG_3X2, mediaType: 'image/png' });
    expect(server.xClient.calls[1]?.args[1]).toEqual({ text: 'Hello', mediaIds: ['media-1'] });
    expect(await monthCostUsd()).toBe(0.015);
  });

  test('publishes a draft after promote and logs the URL price', async () => {
    // Given: a connected account and a draft whose text has a link
    connectTestAccount(server);
    await createPost({ text: 'Read https://example.com' });

    // When: publishing it now
    const response = await request('/api/posts/1/publish', { method: 'POST' });

    // Then: it is published and the link price is logged
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe('published');
    expect(server.xClient.calls.map((call) => call.name)).toEqual(['createPost']);
    expect(server.xClient.calls[0]?.args[1]).toEqual({ text: 'Read https://example.com' });
    expect(await monthCostUsd()).toBe(0.2);
  });

  test('returns every promote check for a draft that is not ready', async () => {
    // Given: a connected account and an empty draft
    connectTestAccount(server);
    await createPost({});

    // When: publishing it now
    const response = await request('/api/posts/1/publish', { method: 'POST' });

    // Then: the promote checks come back and nothing was sent
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'text', message: 'Text is empty' }],
    });
    expect((await getPost(1)).status).toBe('draft');
    expect(server.xClient.calls).toEqual([]);
  });

  test('requires a connected X account', async () => {
    // Given: no account and an official post
    await createPost({ text: 'Hello', official: true });

    // When: publishing it now
    const response = await request('/api/posts/1/publish', { method: 'POST' });

    // Then: 404 and nothing was sent
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: 'not_found',
      message: 'No X account connected',
    });
    expect(server.xClient.calls).toEqual([]);
    expect((await getPost(1)).status).toBe('official');
  });

  test('a failed send marks the post failed and answers 502', async () => {
    // Given: a connected account, an official post, and a send that X rejects
    connectTestAccount(server);
    await createPost({ text: 'Hello', official: true });
    server.xClient.createPostError = new XError('http', 503, 'Service Unavailable');

    // When: publishing it now
    const response = await request('/api/posts/1/publish', { method: 'POST' });

    // Then: 502 and the post is failed with the error kept
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      code: 'publish_failed',
      message: 'Service Unavailable',
    });
    expect(await getPost(1)).toMatchObject({
      status: 'failed',
      last_error: 'Service Unavailable',
      retry_count: 1,
    });
    expect(await monthCostUsd()).toBe(0);
  });

  test('rejects publish on a published or failed post', async () => {
    // Given: a connected account and a published and a failed post
    connectTestAccount(server);
    await createPost({ text: 'One' });
    await createPost({ text: 'Two' });
    setPost(1, { status: 'published' });
    setPost(2, { status: 'failed' });

    // When: publishing each
    const first = await request('/api/posts/1/publish', { method: 'POST' });
    const second = await request('/api/posts/2/publish', { method: 'POST' });

    // Then: both are rejected and nothing was sent
    expect(first.status).toBe(400);
    expect(await first.json()).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'status', message: 'Post 1 is published' }],
    });
    expect(second.status).toBe(400);
    expect(await second.json()).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'status', message: 'Post 2 is failed' }],
    });
    expect(server.xClient.calls).toEqual([]);
  });

  test('published rejects edits, allows local delete, and get returns the X URL', async () => {
    // Given: a connected account and a published post
    connectTestAccount(server);
    await createPost({ text: 'Hello' });
    const published = await request('/api/posts/1/publish', { method: 'POST' });
    expect(published.status).toBe(200);

    // When: patching, scheduling, and attaching media, then reading and deleting
    const patch = await request('/api/posts/1', {
      method: 'PATCH',
      body: JSON.stringify({ text: 'x' }),
    });
    const schedule = await request('/api/posts/1/schedule', {
      method: 'POST',
      body: JSON.stringify({ at: '2026-09-10 09:00' }),
    });
    const attach = await request('/api/posts/1/media', {
      method: 'POST',
      body: JSON.stringify({ resource_ids: [1] }),
    });
    const got = await getPost(1);
    const removed = await request('/api/posts', {
      method: 'DELETE',
      body: JSON.stringify({ ids: [1] }),
    });

    // Then: the mutations are rejected, the X URL reads back, and the delete works
    for (const [response, message] of [
      [patch, 'Post 1 is published'],
      [schedule, 'Post 1 is published'],
      [attach, 'Post 1 is published'],
    ] as const) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        code: 'validation',
        message: 'Invalid request',
        errors: [{ path: 'status', message }],
      });
    }
    expect(got.x_post_url).toBe('https://x.com/perchtester/status/2');
    expect(await removed.json()).toEqual({ results: [{ id: 1, ok: true }] });
    expect(server.xClient.calls.map((call) => call.name)).toEqual(['createPost']);
  });

  test('does not send a post that is already being sent', async () => {
    // Given: a connected account, an official post, and a send that waits on a gate
    connectTestAccount(server);
    await createPost({ text: 'Hello', official: true });
    let release: () => void = () => {};
    server.xClient.createPostGate = new Promise((resolve) => {
      release = resolve;
    });

    // When: two publishes run at once
    const first = request('/api/posts/1/publish', { method: 'POST' });
    const second = await request('/api/posts/1/publish', { method: 'POST' });
    release();
    const firstResponse = await first;

    // Then: the second is 409 and only one send reached X
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({
      code: 'in_flight',
      message: 'Post 1 is being sent',
    });
    expect(firstResponse.status).toBe(200);
    expect(
      server.xClient.calls.filter((call) => call.name === 'createPost'),
    ).toHaveLength(1);
  });
});
