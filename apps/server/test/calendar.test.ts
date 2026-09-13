import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';
import type { CalendarRange, Post } from '@perch/core';
import { eq } from 'drizzle-orm';

import { openDb } from '../src/db';
import { posts, xAccounts } from '../src/db/schema';
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

async function calendar(query: string): Promise<CalendarRange> {
  const response = await request(`/api/calendar${query}`);
  expect(response.status).toBe(200);
  return (await response.json()) as CalendarRange;
}

function dayIds(range: CalendarRange): Array<[string, number[]]> {
  return range.days.map((d) => [d.date, d.posts.map((p) => p.id)]);
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

function connectAccount(): void {
  const { db, sqlite } = openDb(path.join(server.dir, 'perch.db'));
  db.insert(xAccounts)
    .values({
      userId: 1,
      xUserId: '1000',
      username: 'perchtester',
      subscriptionType: 'Premium',
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: new Date('2027-01-01T00:00:00Z'),
      connectedAt: new Date('2026-09-04T10:00:00Z'),
    })
    .run();
  sqlite.close();
}

describe('GET /api/calendar', () => {
  test('groups posts by day, published by published time', async () => {
    // Given: five posts; 3 scheduled Sep 10, 4 scheduled Sep 12,
    // 5 published Sep 11 but scheduled Sep 20
    for (const text of ['one', 'two', 'three', 'four', 'five']) {
      await createPost({ text });
    }
    setPost(3, { scheduledAt: new Date('2026-09-10T09:00:00Z') });
    setPost(4, { scheduledAt: new Date('2026-09-12T09:00:00Z') });
    setPost(5, {
      status: 'published',
      publishedAt: new Date('2026-09-11T09:00:00Z'),
      scheduledAt: new Date('2026-09-20T09:00:00Z'),
    });

    // When
    const range = await calendar('?from=2026-09-01&to=2026-09-30');

    // Then
    expect(range.from).toBe('2026-09-01');
    expect(range.to).toBe('2026-09-30');
    expect(dayIds(range)).toEqual([
      ['2026-09-10', [3]],
      ['2026-09-11', [5]],
      ['2026-09-12', [4]],
    ]);
    expect(range.days[0]?.posts[0]?.title).toBe('three');
    expect(range.days[0]?.posts[0]?.missed).toBe(false);
    expect(range.days[1]?.posts[0]?.tags).toEqual([]);
  });

  test('groups across a time-zone midnight', async () => {
    // Given: timezone Asia/Ho_Chi_Minh; post 1 at 18:00Z Sep 10 (01:00 local Sep 11),
    // post 2 at 16:00Z Sep 10 (23:00 local Sep 10)
    const patched = await request('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ timezone: 'Asia/Ho_Chi_Minh' }),
    });
    expect(patched.status).toBe(200);
    await createPost({ text: 'one' });
    await createPost({ text: 'two' });
    setPost(1, { scheduledAt: new Date('2026-09-10T18:00:00Z') });
    setPost(2, { scheduledAt: new Date('2026-09-10T16:00:00Z') });

    // When / Then
    expect(dayIds(await calendar('?from=2026-09-11&to=2026-09-11'))).toEqual([['2026-09-11', [1]]]);
    expect(dayIds(await calendar('?from=2026-09-10&to=2026-09-10'))).toEqual([['2026-09-10', [2]]]);
    expect(dayIds(await calendar('?from=2026-09-10&to=2026-09-11'))).toEqual([
      ['2026-09-10', [2]],
      ['2026-09-11', [1]],
    ]);
  });

  test('range bounds are inclusive', async () => {
    // Given: post 1 at Sep 10 00:00Z, post 2 at Sep 12 23:59:59Z
    await createPost({ text: 'one' });
    await createPost({ text: 'two' });
    setPost(1, { scheduledAt: new Date('2026-09-10T00:00:00Z') });
    setPost(2, { scheduledAt: new Date('2026-09-12T23:59:59Z') });

    // When / Then
    expect(dayIds(await calendar('?from=2026-09-10&to=2026-09-12'))).toEqual([
      ['2026-09-10', [1]],
      ['2026-09-12', [2]],
    ]);
    expect(dayIds(await calendar('?from=2026-09-11&to=2026-09-11'))).toEqual([]);
    expect(dayIds(await calendar('?from=2026-09-12&to=2026-09-12'))).toEqual([['2026-09-12', [2]]]);
  });

  test('filters by tag', async () => {
    // Given: post 1 tagged x, post 2 untagged, both Sep 10
    await createPost({ text: 'one', tags: ['x'] });
    await createPost({ text: 'two' });
    setPost(1, { scheduledAt: new Date('2026-09-10T09:00:00Z') });
    setPost(2, { scheduledAt: new Date('2026-09-10T10:00:00Z') });

    // When / Then
    expect(dayIds(await calendar('?from=2026-09-01&to=2026-09-30&tag=x'))).toEqual([
      ['2026-09-10', [1]],
    ]);
    expect(dayIds(await calendar('?from=2026-09-01&to=2026-09-30&tag=X'))).toEqual([
      ['2026-09-10', [1]],
    ]);
    expect(dayIds(await calendar('?from=2026-09-01&to=2026-09-30&tag=none'))).toEqual([]);
    expect(dayIds(await calendar('?from=2026-09-01&to=2026-09-30'))).toEqual([
      ['2026-09-10', [1, 2]],
    ]);
  });

  test('marks missed posts', async () => {
    // Given: clock 2026-09-04T10:00Z; 1 past draft, 2 past official,
    // 3 future draft, 4 past failed; no X account
    await createPost({ text: 'one' });
    await createPost({ text: 'two' });
    await createPost({ text: 'three' });
    await createPost({ text: 'four' });
    setPost(1, { scheduledAt: new Date('2026-09-02T09:00:00Z') });
    setPost(2, { status: 'official', scheduledAt: new Date('2026-09-02T10:00:00Z') });
    setPost(3, { scheduledAt: new Date('2026-09-06T09:00:00Z') });
    setPost(4, {
      status: 'failed',
      lastError: 'boom',
      scheduledAt: new Date('2026-09-02T11:00:00Z'),
    });

    // When
    const range = await calendar('?from=2026-09-01&to=2026-09-07');

    // Then
    expect(range.days[0]?.posts.map((p) => [p.id, p.missed])).toEqual([
      [1, true],
      [2, true],
      [4, false],
    ]);
    expect(range.days[1]?.posts.map((p) => [p.id, p.missed])).toEqual([[3, false]]);

    // When: an X account is connected
    connectAccount();
    const connected = await calendar('?from=2026-09-01&to=2026-09-07');

    // Then
    expect(connected.days[0]?.posts.map((p) => [p.id, p.missed])).toEqual([
      [1, true],
      [2, false],
      [4, false],
    ]);
  });

  test('rejects a bad range', async () => {
    // Given / When
    const badFormat = await request('/api/calendar?from=2026-9-1&to=2026-09-30');
    const reversed = await request('/api/calendar?from=2026-09-10&to=2026-09-09');
    const missing = await request('/api/calendar?from=2026-09-10');

    // Then
    expect(badFormat.status).toBe(400);
    const badFormatBody = (await badFormat.json()) as { errors: Array<{ path: string }> };
    expect(badFormatBody.errors[0]?.path).toBe('from');
    expect(reversed.status).toBe(400);
    const reversedBody = (await reversed.json()) as {
      errors: Array<{ path: string; message: string }>;
    };
    expect(reversedBody.errors).toEqual([{ path: 'to', message: 'to is before from' }]);
    expect(missing.status).toBe(400);
    const missingBody = (await missing.json()) as { errors: Array<{ path: string }> };
    expect(missingBody.errors[0]?.path).toBe('to');
  });
});
