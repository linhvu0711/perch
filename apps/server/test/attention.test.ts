import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';
import type { Post, PostList, PostStatusResponse, Status } from '@perch/core';
import { eq } from 'drizzle-orm';

import { openDb } from '../src/db';
import { posts } from '../src/db/schema';
import { connectTestAccount, createTestServer, type TestServer } from '../src/testing';

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

/** The seven-post seed: missed draft, missed official, failed, future draft, later draft, future official, untimed. */
async function seedAttentionPosts(): Promise<void> {
  await createPost({ text: 'Old draft' });
  await createPost({ text: 'Early official', official: true });
  await createPost({ text: 'Broken' });
  await createPost({ text: 'Soon' });
  await createPost({ text: 'Later' });
  await createPost({ text: 'Official soon', official: true });
  await createPost({ text: 'Untimed' });

  setPost(1, { scheduledAt: new Date('2026-09-04T09:00:00Z') });
  setPost(2, { scheduledAt: new Date('2026-09-04T09:00:00Z') });
  setPost(3, {
    status: 'failed',
    lastError: 'Service Unavailable',
    scheduledAt: new Date('2026-09-04T10:15:00Z'),
  });
  setPost(4, { scheduledAt: new Date('2026-09-06T09:00:00Z') });
  setPost(5, { scheduledAt: new Date('2026-09-08T09:00:00Z') });
  setPost(6, { scheduledAt: new Date('2026-09-05T09:00:00Z') });
  server.clock.set(new Date('2026-09-04T10:31:00Z'));
}

describe('needs attention', () => {
  test('lists Missed and Failed with their reasons', async () => {
    // Given: the seven-post seed, account connected, now 2026-09-04T10:31Z
    connectTestAccount(server);
    await seedAttentionPosts();

    // When
    const response = await request('/api/posts?needs_attention=true');

    // Then
    expect(response.status).toBe(200);
    const body = (await response.json()) as PostList;
    expect(body.items.map((post) => post.id)).toEqual([3, 2, 1]);
    expect(body.total).toBe(3);
    expect(body.items.map((post) => post.reason)).toEqual([
      'publish failed: Service Unavailable',
      'time passed, no X account',
      'time passed, still a draft',
    ]);
  });

  test('needs_attention=false keeps the rest', async () => {
    // Given: the same seed
    connectTestAccount(server);
    await seedAttentionPosts();

    // When
    const response = await request('/api/posts?needs_attention=false');

    // Then
    const body = (await response.json()) as PostList;
    expect(body.items.map((post) => post.id)).toEqual([5, 4, 6, 7]);
    expect(body.total).toBe(4);
    expect(body.items.map((post) => post.reason)).toEqual([null, null, null, null]);
  });

  test('a draft at the window edge is due soon but not an Issue', async () => {
    // Given: a draft at now + 3 days and one just past it
    connectTestAccount(server);
    await createPost({ text: 'Edge' });
    await createPost({ text: 'Beyond' });
    setPost(1, { scheduledAt: new Date('2026-09-07T10:31:00Z') });
    setPost(2, { scheduledAt: new Date('2026-09-07T10:31:00.001Z') });
    server.clock.set(new Date('2026-09-04T10:31:00Z'));

    // When
    const response = await request('/api/posts?needs_attention=true');
    const statusResponse = await request('/api/status');

    // Then
    const body = (await response.json()) as PostList;
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
    const status = (await statusResponse.json()) as Status;
    expect(status.due_soon_count).toBe(1);
    expect(status.missed_count).toBe(0);
    expect(status.failed_count).toBe(0);
  });

  test('dismiss unschedules a missed draft, demotes a failed post, leaves a future draft alone, deletes nothing', async () => {
    // Given: the seven-post seed, account connected, clock 2026-09-04T10:31Z
    connectTestAccount(server);
    await seedAttentionPosts();

    // When
    const response = await request('/api/posts/dismiss', {
      method: 'POST',
      body: JSON.stringify({ ids: [1, 2, 3, 4, 5] }),
    });

    // Then
    expect(response.status).toBe(200);
    const body = (await response.json()) as PostStatusResponse;
    expect(body.results).toEqual([
      { id: 1, ok: true },
      { id: 2, ok: true },
      { id: 3, ok: true },
      {
        id: 4,
        ok: false,
        error: { code: 'invalid_status', message: 'Post 4 needs no attention' },
      },
      {
        id: 5,
        ok: false,
        error: { code: 'invalid_status', message: 'Post 5 needs no attention' },
      },
    ]);

    const attention = (await (await request('/api/posts?needs_attention=true')).json()) as PostList;
    expect(attention.items).toEqual([]);
    expect(attention.total).toBe(0);

    const all = (await (await request('/api/posts')).json()) as PostList;
    expect(all.total).toBe(7);

    const first = await getPost(1);
    expect(first.status).toBe('draft');
    expect(first.scheduled_at).toBeNull();
    expect(first.reason).toBeNull();

    const second = await getPost(2);
    expect(second.status).toBe('official');
    expect(second.scheduled_at).toBeNull();
    expect(second.reason).toBeNull();

    const third = await getPost(3);
    expect(third.status).toBe('draft');
    expect(third.scheduled_at).toBeNull();
    expect(third.last_error).toBeNull();
    expect(third.retry_count).toBe(0);
    expect(third.reason).toBeNull();

    const fourth = await getPost(4);
    expect(fourth.status).toBe('draft');
    expect(fourth.scheduled_at).toBe('2026-09-06T09:00:00.000Z');
    expect(fourth.reason).toBeNull();
  });

  test('dismiss reports unknown ids', async () => {
    // Given: a fresh server
    // When
    const response = await request('/api/posts/dismiss', {
      method: 'POST',
      body: JSON.stringify({ ids: [99] }),
    });

    // Then
    expect(response.status).toBe(200);
    const body = (await response.json()) as PostStatusResponse;
    expect(body.results).toEqual([
      { id: 99, ok: false, error: { code: 'not_found', message: 'Post 99 not found' } },
    ]);
  });

  test('status carries the account, the next 5 posts, and the counts', async () => {
    // Given: the seed plus three later posts, clock 2026-09-04T10:31Z
    connectTestAccount(server);
    await seedAttentionPosts();
    await createPost({ text: 'D1' });
    await createPost({ text: 'O2', official: true });
    await createPost({ text: 'D3' });
    setPost(8, { scheduledAt: new Date('2026-09-09T09:00:00Z') });
    setPost(9, { scheduledAt: new Date('2026-09-10T09:00:00Z') });
    setPost(10, { scheduledAt: new Date('2026-09-13T09:00:00Z') });

    // When
    const response = await request('/api/status');

    // Then
    expect(response.status).toBe(200);
    const body = (await response.json()) as Status;
    expect(body.timezone).toBe('UTC');
    expect(body.account?.username).toBe('perchtester');
    expect(body.next_due.map((post) => post.id)).toEqual([6, 4, 5, 8, 9]);
    expect(body.next_official?.id).toBe(6);
    expect(body.missed_count).toBe(2);
    expect(body.failed_count).toBe(1);
    expect(body.due_soon_count).toBe(1);
    expect(body.week_official_count).toBe(2);
    expect(body.week_draft_count).toBe(3);
    expect(body.month_cost_usd).toBe(0);
  });

  test('status with no account and no posts', async () => {
    // Given: a fresh server
    // When
    const response = await request('/api/status');

    // Then
    expect(await response.json()).toEqual({
      timezone: 'UTC',
      account: null,
      next_due: [],
      next_official: null,
      missed_count: 0,
      failed_count: 0,
      due_soon_count: 0,
      week_official_count: 0,
      week_draft_count: 0,
      month_cost_usd: 0,
    });
  });
});
