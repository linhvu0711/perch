import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';
import type { CalendarRange, Post, PostList, PostStatusResponse, Status } from '@perch/core';
import { eq } from 'drizzle-orm';

import { openDb } from '../src/db';
import { postState } from '../src/db/postState';
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

describe('post state', () => {
  test('one Missed on all six reads', async () => {
    // Given: account connected 2026-09-04T10:00Z; five posts at 09:00/10:15/09:00
    connectTestAccount(server);
    await createPost({ text: 'Old draft' });
    await createPost({ text: 'Early official', official: true });
    await createPost({ text: 'Later official', official: true });
    await createPost({ text: 'Broken' });
    await createPost({ text: 'Soon' });
    setPost(1, { scheduledAt: new Date('2026-09-04T09:00:00Z') });
    setPost(2, { scheduledAt: new Date('2026-09-04T09:00:00Z') });
    setPost(3, { scheduledAt: new Date('2026-09-04T10:15:00Z') });
    setPost(4, {
      status: 'failed',
      lastError: 'Service Unavailable',
      scheduledAt: new Date('2026-09-04T10:15:00Z'),
    });
    setPost(5, { scheduledAt: new Date('2026-09-06T09:00:00Z') });
    server.clock.set(new Date('2026-09-04T10:31:00Z'));

    // When
    const reads: Array<[number, boolean, string | null]> = [];
    for (const id of [1, 2, 3, 4, 5]) {
      const response = await request(`/api/posts/${id}`);
      const post = (await response.json()) as Post;
      reads.push([post.id, post.missed, post.reason]);
    }
    const missedResponse = await request('/api/posts?missed=true');
    const attentionResponse = await request('/api/posts?needs_attention=true');
    const calendarResponse = await request('/api/calendar?from=2026-09-01&to=2026-09-07');
    const statusResponse = await request('/api/status');
    const dismissResponse = await request('/api/posts/dismiss', {
      method: 'POST',
      body: JSON.stringify({ ids: [1, 2, 3, 4, 5] }),
    });
    const secondStatusResponse = await request('/api/status');

    // Then
    expect(reads).toEqual([
      [1, true, 'time passed, still a draft'],
      [2, true, 'time passed, no X account'],
      [3, false, null],
      [4, false, 'publish failed: Service Unavailable'],
      [5, false, null],
    ]);
    const missed = (await missedResponse.json()) as PostList;
    expect(missed.items.map((post) => post.id)).toEqual([2, 1]);
    expect(missed.total).toBe(2);
    const attention = (await attentionResponse.json()) as PostList;
    expect(attention.items.map((post) => post.id)).toEqual([4, 2, 1]);
    expect(attention.total).toBe(3);
    const calendar = (await calendarResponse.json()) as CalendarRange;
    expect(calendar.days.map((d) => [d.date, d.posts.map((p) => [p.id, p.missed])])).toEqual([
      [
        '2026-09-04',
        [
          [1, true],
          [2, true],
          [3, false],
          [4, false],
        ],
      ],
      ['2026-09-06', [[5, false]]],
    ]);
    const status = (await statusResponse.json()) as Status;
    expect(status.missed_count).toBe(2);
    expect(status.failed_count).toBe(1);
    const dismiss = (await dismissResponse.json()) as PostStatusResponse;
    expect(dismiss.results).toEqual([
      { id: 1, ok: true },
      { id: 2, ok: true },
      {
        id: 3,
        ok: false,
        error: { code: 'invalid_status', message: 'Post 3 needs no attention' },
      },
      { id: 4, ok: true },
      {
        id: 5,
        ok: false,
        error: { code: 'invalid_status', message: 'Post 5 needs no attention' },
      },
    ]);
    const secondStatus = (await secondStatusResponse.json()) as Status;
    expect(secondStatus.missed_count).toBe(0);
    expect(secondStatus.failed_count).toBe(0);
  });

  test('postState maps a row to missed, reason, and dismiss', () => {
    expect(postState({ status: 'draft', missed: 1, lastError: null })).toEqual({
      missed: true,
      reason: 'time passed, still a draft',
      dismiss: 'unschedule',
    });
    expect(postState({ status: 'official', missed: 1, lastError: null })).toEqual({
      missed: true,
      reason: 'time passed, no X account',
      dismiss: 'unschedule',
    });
    expect(postState({ status: 'published', missed: 0, lastError: null })).toEqual({
      missed: false,
      reason: null,
      dismiss: null,
    });
    expect(postState({ status: 'official', missed: 0, lastError: null })).toEqual({
      missed: false,
      reason: null,
      dismiss: null,
    });
    expect(postState({ status: 'failed', missed: 0, lastError: 'Service Unavailable' })).toEqual({
      missed: false,
      reason: 'publish failed: Service Unavailable',
      dismiss: 'demote',
    });
    expect(postState({ status: 'failed', missed: 1, lastError: null })).toEqual({
      missed: true,
      reason: 'publish failed',
      dismiss: 'demote',
    });
  });

  test('empty Issues on a fresh server', async () => {
    // Given: a fresh server, no account, no posts
    // When
    const response = await request('/api/posts?needs_attention=true');
    const statusResponse = await request('/api/status');

    // Then
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ items: [], total: 0 });
    const status = (await statusResponse.json()) as Status;
    expect(status.missed_count).toBe(0);
  });
});
