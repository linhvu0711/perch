import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { type Post, X_ENDPOINTS } from '@perch/core';
import { asc, eq } from 'drizzle-orm';

import { openDb } from '../src/db';
import { apiCalls, posts, xAccounts } from '../src/db/schema';
import {
  connectTestAccount,
  createTestServer,
  disconnectTestAccount,
  PNG_3X2,
  type TestServer,
} from '../src/testing';
import { XError } from '../src/x/client';

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

function mediaDir(postId: number): string {
  return path.join(server.dir, 'uploads', '1', 'posts', String(postId));
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

  test('leaves a valid draft a draft when no account is connected', async () => {
    // Given: no account and a valid draft
    await createPost({ text: 'Hello' });

    // When: publishing it now
    const response = await request('/api/posts/1/publish', { method: 'POST' });

    // Then: 404 and the post is still a draft
    expect(response.status).toBe(404);
    expect((await getPost(1)).status).toBe('draft');
    expect(server.xClient.calls).toEqual([]);
  });

  test('returns the promote checks for an invalid draft even with no account', async () => {
    // Given: no account and an empty draft
    await createPost({});

    // When: publishing it now
    const response = await request('/api/posts/1/publish', { method: 'POST' });

    // Then: promote's checks come back instead of the account error
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'text', message: 'Text is empty' }],
    });
    expect((await getPost(1)).status).toBe('draft');
  });

  test('runs the promote checks once', async () => {
    // Given: a connected account and a draft with one image
    connectTestAccount(server);
    await createPost({ text: 'Hello' });
    await attachPng(1);
    const exists = spyOn(fs, 'existsSync');

    // When: publishing it now
    const response = await request('/api/posts/1/publish', { method: 'POST' });
    const mediaStats = exists.mock.calls.filter(([file]) =>
      String(file).startsWith(mediaDir(1)),
    ).length;
    exists.mockRestore();

    // Then: the media file was stat'ed once for the check, once for the send, once for ready
    expect(response.status).toBe(200);
    expect(mediaStats).toBe(3);
  });

  test('logs one api_calls row per billed X call for a publish with two media', async () => {
    // Given: a connected account and an official post with two images
    connectTestAccount(server);
    await createPost({ text: 'Hello', official: true });
    await attachPng(1);
    await attachPng(1);

    // When: publishing it now
    const response = await request('/api/posts/1/publish', { method: 'POST' });

    // Then: one api_calls row per billed X call, in call order
    expect(response.status).toBe(200);
    expect(server.xClient.calls.map((call) => call.name)).toEqual([
      'uploadMedia',
      'uploadMedia',
      'createPost',
    ]);
    const { db, sqlite } = openDb(path.join(server.dir, 'perch.db'));
    const rows = db
      .select({ endpoint: apiCalls.endpoint, costUsd: apiCalls.costUsd, postId: apiCalls.postId })
      .from(apiCalls)
      .orderBy(asc(apiCalls.id))
      .all();
    sqlite.close();
    expect(rows).toEqual([
      { endpoint: 'POST /2/media/upload', costUsd: 0, postId: 1 },
      { endpoint: 'POST /2/media/upload', costUsd: 0, postId: 1 },
      { endpoint: 'POST /2/tweets', costUsd: 0.015, postId: 1 },
    ]);
    expect(rows.map((row) => row.endpoint)).toEqual(
      server.xClient.calls.map(
        (call) =>
          ({ uploadMedia: X_ENDPOINTS.uploadMedia, createPost: X_ENDPOINTS.createPost })[
            call.name as 'uploadMedia' | 'createPost'
          ],
      ),
    );
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
    expect(server.xClient.calls.filter((call) => call.name === 'createPost')).toHaveLength(1);
  });
});

describe('scheduler tick', () => {
  test('sends a due official post and leaves a due draft alone', async () => {
    // Given: a connected account, a due draft, and a due official post
    connectTestAccount(server);
    await createPost({ text: 'One' });
    await createPost({ text: 'Two', official: true });
    setPost(1, { scheduledAt: new Date('2026-09-04T10:30:00Z') });
    setPost(2, { scheduledAt: new Date('2026-09-04T10:30:00Z') });

    // When: the tick runs after the time
    await server.tick(new Date('2026-09-04T10:30:05Z'));

    // Then: the official post is published and the draft is untouched
    expect(await getPost(2)).toMatchObject({
      status: 'published',
      x_post_id: '2',
      published_at: '2026-09-04T10:30:05.000Z',
      scheduled_at: null,
    });
    expect(await getPost(1)).toMatchObject({
      status: 'draft',
      scheduled_at: '2026-09-04T10:30:00.000Z',
    });
    expect(server.xClient.calls.map((call) => call.name)).toEqual(['createPost']);
    expect(server.xClient.calls[0]?.args[1]).toEqual({ text: 'Two' });
  });

  test('does not send before the schedule time', async () => {
    // Given: a connected account and an official post scheduled ahead
    connectTestAccount(server);
    await createPost({ text: 'Two', official: true });
    setPost(1, { scheduledAt: new Date('2026-09-04T10:30:00Z') });

    // When: the tick runs one second early
    await server.tick(new Date('2026-09-04T10:29:59Z'));

    // Then: nothing was sent
    expect(server.xClient.calls).toEqual([]);
    expect((await getPost(1)).status).toBe('official');
  });

  test('leaves a due post alone while no account is connected now', async () => {
    // Given: a post whose account was connected at its time but is gone now
    connectTestAccount(server);
    await createPost({ text: 'One', official: true });
    setPost(1, { scheduledAt: new Date('2026-09-04T10:30:00Z') });
    disconnectTestAccount(server, new Date('2026-09-04T10:31:00Z'));

    // When: the tick runs after the disconnect
    await server.tick(new Date('2026-09-04T10:32:00Z'));

    // Then: nothing was sent and the row is unchanged
    expect(server.xClient.calls).toEqual([]);
    expect(await getPost(1)).toMatchObject({
      status: 'official',
      retry_count: 0,
      last_error: null,
    });
  });

  test("never sends a due post whose time fell outside the account's connected window", async () => {
    // Given: a post scheduled before the account was connected
    connectTestAccount(server);
    await createPost({ text: 'One', official: true });
    setPost(1, { scheduledAt: new Date('2026-09-04T09:00:00Z') });

    // When: the tick runs after the account connected
    await server.tick(new Date('2026-09-04T10:05:00Z'));

    // Then: nothing was sent
    expect(server.xClient.calls).toEqual([]);
    expect((await getPost(1)).status).toBe('official');
  });

  test('retries at +1, +5, +15 from the schedule time, then fails with the error and keeps the time', async () => {
    // Given: a connected account, a due official post, and a send that always fails
    connectTestAccount(server);
    await createPost({ text: 'Hello', official: true });
    setPost(1, { scheduledAt: new Date('2026-09-04T10:30:00Z') });
    server.xClient.createPostError = new XError('http', 503, 'Service Unavailable');

    // When: ticks run at the schedule time and around each retry offset
    const createPostCalls = () =>
      server.xClient.calls.filter((call) => call.name === 'createPost').length;
    await server.tick(new Date('2026-09-04T10:30:00Z'));
    expect(createPostCalls()).toBe(1);
    await server.tick(new Date('2026-09-04T10:30:30Z'));
    expect(createPostCalls()).toBe(1);
    await server.tick(new Date('2026-09-04T10:31:00Z'));
    expect(createPostCalls()).toBe(2);
    await server.tick(new Date('2026-09-04T10:34:59Z'));
    expect(createPostCalls()).toBe(2);
    await server.tick(new Date('2026-09-04T10:35:00Z'));
    expect(createPostCalls()).toBe(3);
    await server.tick(new Date('2026-09-04T10:45:00Z'));
    expect(createPostCalls()).toBe(4);

    // Then: the post is failed with the error and its schedule time kept
    expect(await getPost(1)).toMatchObject({
      status: 'failed',
      last_error: 'Service Unavailable',
      retry_count: 4,
      scheduled_at: '2026-09-04T10:30:00.000Z',
    });
    expect(await monthCostUsd()).toBe(0);
  });

  test('a retry that succeeds publishes the post', async () => {
    // Given: a due official post whose first send fails
    connectTestAccount(server);
    await createPost({ text: 'Hello', official: true });
    setPost(1, { scheduledAt: new Date('2026-09-04T10:30:00Z') });
    server.xClient.createPostError = new XError('http', 503, 'Service Unavailable');

    // When: the first attempt fails and the retry at +1 succeeds
    await server.tick(new Date('2026-09-04T10:30:00Z'));
    server.xClient.createPostError = null;
    await server.tick(new Date('2026-09-04T10:31:00Z'));

    // Then: the post is published and the count keeps the failed try
    expect(await getPost(1)).toMatchObject({
      status: 'published',
      retry_count: 1,
      scheduled_at: null,
      last_error: null,
    });
    expect(server.xClient.calls.filter((call) => call.name === 'createPost')).toHaveLength(2);
  });

  test('never touches published or failed posts', async () => {
    // Given: a connected account, a published post, and a failed post, both timed
    connectTestAccount(server);
    await createPost({ text: 'One' });
    await createPost({ text: 'Two' });
    setPost(1, { status: 'published', scheduledAt: new Date('2026-09-04T10:30:00Z') });
    setPost(2, {
      status: 'failed',
      scheduledAt: new Date('2026-09-04T10:30:00Z'),
      retryCount: 4,
      lastError: 'old',
    });

    // When: the tick runs past the time
    await server.tick(new Date('2026-09-04T10:31:00Z'));

    // Then: nothing was sent and both rows are unchanged
    expect(server.xClient.calls).toEqual([]);
    expect(await getPost(2)).toMatchObject({
      status: 'failed',
      retry_count: 4,
      last_error: 'old',
    });
    expect((await getPost(1)).status).toBe('published');
  });

  test('a reschedule clears the pending retry', async () => {
    // Given: a due official post whose first send failed, so a +1 minute retry is stored
    connectTestAccount(server);
    await createPost({ text: 'Hello', official: true });
    setPost(1, { scheduledAt: new Date('2026-09-04T10:30:00Z') });
    server.xClient.createPostError = new XError('http', 503, 'Service Unavailable');
    await server.tick(new Date('2026-09-04T10:30:00Z'));
    server.xClient.createPostError = null;

    // When: the post is rescheduled for the afternoon
    const schedule = await request('/api/posts/1/schedule', {
      method: 'POST',
      body: JSON.stringify({ at: '2026-09-04 15:00' }),
    });
    expect(schedule.status).toBe(200);

    // Then: the stale retry deadline does not fire, and the new time sends once
    const createPostCalls = () =>
      server.xClient.calls.filter((call) => call.name === 'createPost').length;
    await server.tick(new Date('2026-09-04T10:31:00Z'));
    expect(createPostCalls()).toBe(1);
    await server.tick(new Date('2026-09-04T15:00:00Z'));
    expect(createPostCalls()).toBe(2);
    expect((await getPost(1)).status).toBe('published');
  });

  test('a due post waits when the access token cannot be refreshed', async () => {
    // Given: a connected account with an expired token and a refresh endpoint that is down
    connectTestAccount(server);
    const { db, sqlite } = openDb(path.join(server.dir, 'perch.db'));
    db.update(xAccounts)
      .set({ expiresAt: new Date('2026-09-04T10:01:00Z') })
      .where(eq(xAccounts.id, 1))
      .run();
    sqlite.close();
    server.xClient.refreshError = new XError('http', 500, 'Internal Server Error');
    await createPost({ text: 'Hello', official: true });
    setPost(1, { scheduledAt: new Date('2026-09-04T10:30:00Z') });

    // When: the tick runs after the time
    await server.tick(new Date('2026-09-04T10:31:00Z'));

    // Then: nothing was sent and no retry was consumed
    expect(server.xClient.calls.filter((call) => call.name === 'createPost')).toHaveLength(0);
    expect(await getPost(1)).toMatchObject({
      status: 'official',
      retry_count: 0,
      last_error: null,
      scheduled_at: '2026-09-04T10:30:00.000Z',
    });

    // When: refresh recovers and a later tick runs
    server.xClient.refreshError = null;
    await server.tick(new Date('2026-09-04T10:32:00Z'));

    // Then: the post sends
    expect((await getPost(1)).status).toBe('published');
  });

  test('answers 503 when the token cannot be refreshed', async () => {
    // Given: a connected account with an expired token and a refresh endpoint that is down
    connectTestAccount(server);
    const { db, sqlite } = openDb(path.join(server.dir, 'perch.db'));
    db.update(xAccounts)
      .set({ expiresAt: new Date('2026-09-04T10:01:00Z') })
      .where(eq(xAccounts.id, 1))
      .run();
    sqlite.close();
    server.xClient.refreshError = new XError('http', 500, 'Internal Server Error');
    await createPost({ text: 'Hello', official: true });

    // When
    const res = await request('/api/posts/1/publish', { method: 'POST' });

    // Then
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      code: 'token_refresh_failed',
      message: 'X token refresh failed',
    });
    expect(server.xClient.calls.filter((call) => call.name === 'createPost')).toHaveLength(0);
    expect((await getPost(1)).status).toBe('official');
  });

  test('does not send a post claimed by an overlapping tick', async () => {
    // Given: a connected account, a due official post, and a send that waits on a gate
    connectTestAccount(server);
    await createPost({ text: 'One', official: true });
    setPost(1, { scheduledAt: new Date('2026-09-04T10:30:00Z') });
    let release: () => void = () => {};
    server.xClient.createPostGate = new Promise((resolve) => {
      release = resolve;
    });

    // When: two ticks overlap on the same due post
    const first = server.tick(new Date('2026-09-04T10:31:00Z'));
    await server.tick(new Date('2026-09-04T10:31:00Z'));
    release();
    await first;

    // Then: the send happened once and the post is published
    expect(server.xClient.calls.filter((call) => call.name === 'createPost')).toHaveLength(1);
    expect((await getPost(1)).status).toBe('published');
  });
});

describe('missed', () => {
  test('reads a due draft as missed and a future one as not', async () => {
    // Given: draft post 1 scheduled in the past, draft post 2 in the future
    await createPost({ text: 'Past' });
    await createPost({ text: 'Future' });
    setPost(1, { scheduledAt: new Date('2026-09-04T09:00:00Z') });
    setPost(2, { scheduledAt: new Date('2026-09-10T09:00:00Z') });

    // When/Then: the past one is missed, the future one is not
    expect((await getPost(1)).missed).toBe(true);
    expect((await getPost(2)).missed).toBe(false);
  });

  test('reads a due official post as missed only when no account was connected at its time', async () => {
    // Given: the account connected at 10:00Z; post 1 scheduled before, post 2 after
    connectTestAccount(server);
    await createPost({ text: 'Before', official: true });
    await createPost({ text: 'After', official: true });
    setPost(1, { scheduledAt: new Date('2026-09-04T09:00:00Z') });
    setPost(2, { scheduledAt: new Date('2026-09-04T10:30:00Z') });
    server.clock.set(new Date('2026-09-04T10:31:00Z'));

    // When/Then: post 1's time was before the connect so it is missed; post 2's was not
    expect((await getPost(1)).missed).toBe(true);
    expect((await getPost(2)).missed).toBe(false);
  });

  test('a disconnect at the time reads as missed and is never sent', async () => {
    // Given: the account connected at 10:00Z and disconnected at 10:20Z
    connectTestAccount(server);
    disconnectTestAccount(server, new Date('2026-09-04T10:20:00Z'));
    await createPost({ text: 'Due', official: true });
    setPost(1, { scheduledAt: new Date('2026-09-04T10:30:00Z') });
    server.clock.set(new Date('2026-09-04T10:31:00Z'));

    // When: a tick runs past the schedule time
    await server.tick(new Date('2026-09-04T10:31:00Z'));

    // Then: the post was never sent and reads as missed
    expect(server.xClient.calls).toEqual([]);
    expect(await getPost(1)).toMatchObject({ status: 'official', missed: true });
  });

  test('filters missed posts', async () => {
    // Given: missed posts 1 (draft) and 2 (official before connect), plus 3 and 4 not missed
    connectTestAccount(server);
    await createPost({ text: 'Draft due' });
    await createPost({ text: 'Official early', official: true });
    await createPost({ text: 'Official future', official: true });
    await createPost({ text: 'Untimed' });
    setPost(1, { scheduledAt: new Date('2026-09-04T09:00:00Z') });
    setPost(2, { scheduledAt: new Date('2026-09-04T09:00:00Z') });
    setPost(3, { scheduledAt: new Date('2026-09-04T10:30:00Z') });
    server.clock.set(new Date('2026-09-04T10:31:00Z'));

    // When: filtering by missed
    const missedOnly = await request('/api/posts?missed=true');
    const notMissed = await request('/api/posts?missed=false');

    // Then: each side holds only its posts
    const missedJson = (await missedOnly.json()) as { items: Post[]; total: number };
    expect(missedJson.items.map((item) => item.id)).toEqual([2, 1]);
    expect(missedJson.total).toBe(2);
    const notMissedJson = (await notMissed.json()) as { items: Post[]; total: number };
    expect(notMissedJson.items.map((item) => item.id)).toEqual([3, 4]);
    expect(notMissedJson.total).toBe(2);
  });

  test('failed and published posts are never missed', async () => {
    // Given: a failed post and a published post, each scheduled in the past
    await createPost({ text: 'Failed' });
    await createPost({ text: 'Published' });
    setPost(1, { status: 'failed', scheduledAt: new Date('2026-09-04T09:00:00Z') });
    setPost(2, {
      status: 'published',
      publishedAt: new Date('2026-09-04T09:00:00Z'),
      scheduledAt: null,
    });

    // When/Then: neither is missed
    expect((await getPost(1)).missed).toBe(false);
    expect((await getPost(2)).missed).toBe(false);
  });
});

describe('retry', () => {
  test('retry sends a failed post once and publishes it', async () => {
    // Given: a connected account and a failed post that already tried four times
    connectTestAccount(server);
    await createPost({ text: 'Hello' });
    setPost(1, {
      status: 'failed',
      lastError: 'old',
      retryCount: 4,
      scheduledAt: new Date('2026-09-04T10:30:00Z'),
    });

    // When: retrying it
    const response = await request('/api/posts/1/retry', { method: 'POST' });

    // Then: sent once and published; the schedule time is cleared, the count kept
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'published',
      x_post_id: '2',
      last_error: null,
      scheduled_at: null,
      retry_count: 4,
    });
    expect(server.xClient.calls.map((call) => call.name)).toEqual(['createPost']);
    expect(await monthCostUsd()).toBeCloseTo(0.015);
  });

  test('retry keeps failed with the new error and counts the try', async () => {
    // Given: a failed post and X answering 429
    connectTestAccount(server);
    await createPost({ text: 'Hello' });
    setPost(1, {
      status: 'failed',
      lastError: 'old',
      retryCount: 4,
      scheduledAt: new Date('2026-09-04T10:30:00Z'),
    });
    server.xClient.createPostError = new XError('http', 429, 'Too Many Requests');

    // When: retrying it
    const response = await request('/api/posts/1/retry', { method: 'POST' });

    // Then: 502 with the X error; the post stays failed with the time kept and the try counted
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      code: 'publish_failed',
      message: 'Too Many Requests',
    });
    expect(await getPost(1)).toMatchObject({
      status: 'failed',
      last_error: 'Too Many Requests',
      retry_count: 5,
      scheduled_at: '2026-09-04T10:30:00.000Z',
    });
  });

  test('retry rejects a post that is not failed', async () => {
    // Given: a connected account and an official post
    connectTestAccount(server);
    await createPost({ text: 'Hello', official: true });

    // When: retrying it
    const response = await request('/api/posts/1/retry', { method: 'POST' });

    // Then: 400 naming the status, nothing sent
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'status', message: 'Post 1 is official' }],
    });
    expect(server.xClient.calls).toEqual([]);
  });
});

describe('in flight', () => {
  test('refuses an edit while the post is being sent and X gets the old text', async () => {
    // Given: a connected account, an official post, and a send that waits on a gate
    connectTestAccount(server);
    await createPost({ text: 'Hello', official: true });
    let release: () => void = () => {};
    server.xClient.createPostGate = new Promise((resolve) => {
      release = resolve;
    });

    // When: a publish holds the send and an edit arrives before it answers
    const first = request('/api/posts/1/publish', { method: 'POST' });
    const patch = await request('/api/posts/1', {
      method: 'PATCH',
      body: JSON.stringify({ text: 'Changed' }),
    });
    release();
    const firstResponse = await first;

    // Then: the edit is refused and X received the text the send started with
    expect(patch.status).toBe(409);
    expect(await patch.json()).toEqual({
      code: 'in_flight',
      message: 'Post 1 is being sent',
    });
    expect(firstResponse.status).toBe(200);
    const created = server.xClient.calls.filter((call) => call.name === 'createPost');
    expect(created).toHaveLength(1);
    expect(created[0]?.args[1]).toEqual({ text: 'Hello' });
    expect(await getPost(1)).toMatchObject({
      text: 'Hello',
      status: 'published',
      x_post_id: '2',
    });
  });

  test('edits and deletes work again after the send ends', async () => {
    // Given: post 1 published through a released send, post 2 failed by X
    connectTestAccount(server);
    await createPost({ text: 'Hello', official: true });
    let release: () => void = () => {};
    server.xClient.createPostGate = new Promise((resolve) => {
      release = resolve;
    });
    const first = request('/api/posts/1/publish', { method: 'POST' });
    release();
    const firstResponse = await first;
    expect(firstResponse.status).toBe(200);
    await createPost({ text: 'Two', official: true });
    server.xClient.createPostError = new XError('http', 503, 'Service Unavailable');
    const failed = await request('/api/posts/2/publish', { method: 'POST' });
    expect(failed.status).toBe(502);

    // When: editing and deleting after the sends ended
    const patchPublished = await request('/api/posts/1', {
      method: 'PATCH',
      body: JSON.stringify({ text: 'Changed' }),
    });
    const del = await request('/api/posts', {
      method: 'DELETE',
      body: JSON.stringify({ ids: [1] }),
    });
    const patchFailed = await request('/api/posts/2', {
      method: 'PATCH',
      body: JSON.stringify({ text: 'Changed' }),
    });

    // Then: the usual rules apply again
    expect(patchPublished.status).toBe(400);
    expect(await patchPublished.json()).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'status', message: 'Post 1 is published' }],
    });
    expect(await del.json()).toEqual({ results: [{ id: 1, ok: true }] });
    expect(patchFailed.status).toBe(200);
    expect((await getPost(2)).text).toBe('Changed');
  });

  test('refuses a delete of a post being sent, deletes the rest, and keeps the row and media', async () => {
    // Given: post 1 with media being sent on a held gate, and post 2
    connectTestAccount(server);
    await createPost({ text: 'Hello', official: true });
    await attachPng(1);
    await createPost({ text: 'Two' });
    let release: () => void = () => {};
    server.xClient.createPostGate = new Promise((resolve) => {
      release = resolve;
    });

    // When: a publish holds the send and a batch delete arrives before it answers
    const first = request('/api/posts/1/publish', { method: 'POST' });
    const del = await request('/api/posts', {
      method: 'DELETE',
      body: JSON.stringify({ ids: [1, 2] }),
    });
    release();
    const firstResponse = await first;

    // Then: id 1 is refused per-id, id 2 is gone, and post 1 kept its row and media
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({
      results: [
        {
          id: 1,
          ok: false,
          error: { code: 'in_flight', message: 'Post 1 is being sent' },
        },
        { id: 2, ok: true },
      ],
    });
    expect(firstResponse.status).toBe(200);
    expect(await getPost(1)).toMatchObject({ status: 'published', x_post_id: '2' });
    expect((await getPost(1)).media).toHaveLength(1);
    expect(fs.existsSync(mediaDir(1))).toBe(true);
    expect((await request('/api/posts/2')).status).toBe(404);
  });

  test('refuses media changes while the post is being sent and X gets the media the send started with', async () => {
    // Given: a connected account and post 1 with one image being sent on a held gate
    connectTestAccount(server);
    await createPost({ text: 'Hello', official: true });
    await attachPng(1);
    let release: () => void = () => {};
    server.xClient.createPostGate = new Promise((resolve) => {
      release = resolve;
    });

    // When: a publish holds the send and media changes arrive before it answers
    const form = new FormData();
    form.append(
      'files',
      new File([PNG_3X2.slice().buffer as ArrayBuffer], 'b.png', { type: 'image/png' }),
    );
    const first = request('/api/posts/1/publish', { method: 'POST' });
    const files = await request('/api/posts/1/media/files', {
      method: 'POST',
      body: form,
    });
    const attach = await request('/api/posts/1/media', {
      method: 'POST',
      body: JSON.stringify({ resource_ids: [1] }),
    });
    const detach = await request('/api/posts/1/media', {
      method: 'DELETE',
      body: JSON.stringify({ all: true }),
    });
    release();
    const firstResponse = await first;

    // Then: each change is refused and X got the media the send started with
    for (const response of [files, attach, detach]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        code: 'in_flight',
        message: 'Post 1 is being sent',
      });
    }
    expect(firstResponse.status).toBe(200);
    expect(server.xClient.calls.map((call) => call.name)).toEqual([
      'uploadMedia',
      'createPost',
    ]);
    expect(server.xClient.calls[1]?.args[1]).toEqual({
      text: 'Hello',
      mediaIds: ['media-1'],
    });
    expect((await getPost(1)).media).toHaveLength(1);
  });

  test('refuses demote, unschedule, dismiss, and schedule while the post is being sent', async () => {
    // Given: a connected account, post 1 being sent on a held gate, and post 2
    connectTestAccount(server);
    await createPost({ text: 'Hello', official: true });
    await createPost({ text: 'Two', official: true });
    let release: () => void = () => {};
    server.xClient.createPostGate = new Promise((resolve) => {
      release = resolve;
    });

    // When: a publish holds the send and status changes arrive before it answers
    const first = request('/api/posts/1/publish', { method: 'POST' });
    const demote = await request('/api/posts/demote', {
      method: 'POST',
      body: JSON.stringify({ ids: [1, 2] }),
    });
    const unschedule = await request('/api/posts/unschedule', {
      method: 'POST',
      body: JSON.stringify({ ids: [1] }),
    });
    const dismiss = await request('/api/posts/dismiss', {
      method: 'POST',
      body: JSON.stringify({ ids: [1] }),
    });
    const schedule = await request('/api/posts/1/schedule', {
      method: 'POST',
      body: JSON.stringify({ at: '2026-09-05 10:00' }),
    });
    release();
    const firstResponse = await first;

    // Then: id 1 is refused everywhere, id 2 demotes, and post 1 ends published
    expect(await demote.json()).toEqual({
      results: [
        {
          id: 1,
          ok: false,
          error: { code: 'in_flight', message: 'Post 1 is being sent' },
        },
        { id: 2, ok: true },
      ],
    });
    for (const response of [unschedule, dismiss]) {
      expect(await response.json()).toEqual({
        results: [
          {
            id: 1,
            ok: false,
            error: { code: 'in_flight', message: 'Post 1 is being sent' },
          },
        ],
      });
    }
    expect(schedule.status).toBe(409);
    expect(await schedule.json()).toEqual({
      code: 'in_flight',
      message: 'Post 1 is being sent',
    });
    expect(firstResponse.status).toBe(200);
    expect(await getPost(1)).toMatchObject({ status: 'published', scheduled_at: null });
    expect((await getPost(2)).status).toBe('draft');
  });
});
