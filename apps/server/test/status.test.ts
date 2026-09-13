import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { type Post, type PostList, type PostStatusResponse, zonedParts } from '@perch/core';
import { eq } from 'drizzle-orm';

import { openDb } from '../src/db';
import { posts, xAccounts } from '../src/db/schema';
import { createTestServer, PNG_3X2, type TestServer } from '../src/testing';

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

async function postStatus(path: string, ids: number[]): Promise<PostStatusResponse> {
  const response = await request(path, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as PostStatusResponse;
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

/** Posts 1-5: untimed drafts 1, 2; scheduled 3 (Sep 10), 4 (Sep 12); published 5 (Sep 11). */
async function seedTimedPosts(): Promise<void> {
  await createPost({ text: 'banana split\nsecond line' });
  await createPost({ text: 'two' });
  await createPost({ text: 'three' });
  await createPost({ text: 'four' });
  await createPost({ text: 'five' });

  const { db, sqlite } = openDb(path.join(server.dir, 'perch.db'));
  db.update(posts)
    .set({ scheduledAt: new Date('2026-09-10T09:00:00Z') })
    .where(eq(posts.id, 3))
    .run();
  db.update(posts)
    .set({ scheduledAt: new Date('2026-09-12T09:00:00Z') })
    .where(eq(posts.id, 4))
    .run();
  db.update(posts)
    .set({ status: 'published', publishedAt: new Date('2026-09-11T09:00:00Z') })
    .where(eq(posts.id, 5))
    .run();
  sqlite.close();
}

async function uploadImage(name: string): Promise<void> {
  const form = new FormData();
  form.append(
    'files',
    new File([PNG_3X2.slice().buffer as ArrayBuffer], name, { type: 'image/png' }),
  );
  const response = await request('/api/resources/images', { method: 'POST', body: form });
  expect(response.status).toBe(200);
}

function mediaDir(postId: number): string {
  return path.join(server.dir, 'uploads', '1', 'posts', String(postId));
}

describe('status', () => {
  test('reflects the configured time zone', async () => {
    const initial = await request('/api/status');
    expect(await initial.json()).toEqual({
      timezone: 'UTC',
      month_cost_usd: 0,
    });

    await request('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ timezone: 'Europe/Berlin' }),
    });

    const updated = await request('/api/status');
    expect(await updated.json()).toEqual({
      timezone: 'Europe/Berlin',
      month_cost_usd: 0,
    });
  });

  test('exposes a resolving scheduler tick', async () => {
    await expect(server.tick(server.clock.now())).resolves.toBeUndefined();
  });
});

describe('post status', () => {
  test('promote returns every failing check at once', async () => {
    // Given: post 1 over-limit text plus a media row whose file is missing; post 2 empty
    await createPost({ text: 'x'.repeat(281) });
    await createPost({ text: '' });
    await uploadImage('a.png');
    const attached = await request('/api/posts/1/media', {
      method: 'POST',
      body: JSON.stringify({ resource_ids: [1] }),
    });
    expect(attached.status).toBe(200);
    const files = fs.readdirSync(mediaDir(1));
    for (const file of files) {
      fs.unlinkSync(path.join(mediaDir(1), file));
    }

    // When: promoting 1, 2, and an unknown id
    const response = await postStatus('/api/posts/promote', [1, 2, 999]);

    // Then: every failing check is reported per item
    expect(response).toEqual({
      results: [
        {
          id: 1,
          ok: false,
          error: {
            code: 'validation',
            message: 'Post 1 is not ready',
            errors: [
              { path: 'text', message: '281 of 280 characters' },
              { path: 'media', message: 'Media 1 file is missing' },
            ],
          },
        },
        {
          id: 2,
          ok: false,
          error: {
            code: 'validation',
            message: 'Post 2 is not ready',
            errors: [{ path: 'text', message: 'Text is empty' }],
          },
        },
        { id: 999, ok: false, error: { code: 'not_found', message: 'Post 999 not found' } },
      ],
    });
    expect((await getPost(1)).status).toBe('draft');
  });

  test('promote moves a ready draft to official', async () => {
    // Given: a publishable draft
    await createPost({ text: 'Hello' });

    // When: promoting it twice
    const first = await postStatus('/api/posts/promote', [1]);
    const second = await postStatus('/api/posts/promote', [1]);

    // Then: the first promotes, the second reports the new status
    expect(first).toEqual({ results: [{ id: 1, ok: true }] });
    const post = await getPost(1);
    expect(post.status).toBe('official');
    expect(post.updated_at).toBe('2026-09-04T10:00:00.000Z');
    expect(second).toEqual({
      results: [
        { id: 1, ok: false, error: { code: 'invalid_status', message: 'Post 1 is official' } },
      ],
    });
  });

  test('demote clears the error and retry count', async () => {
    // Given: an official post and a failed post with error fields set, plus a plain draft
    await createPost({ text: 'one' });
    await createPost({ text: 'two' });
    await createPost({ text: 'three' });
    setPost(1, { status: 'official', lastError: 'boom', retryCount: 2 });
    setPost(2, { status: 'failed', lastError: 'boom', retryCount: 3 });

    // When: demoting all three
    const response = await postStatus('/api/posts/demote', [1, 2, 3]);

    // Then: official and failed demote; the draft reports
    expect(response).toEqual({
      results: [
        { id: 1, ok: true },
        { id: 2, ok: true },
        { id: 3, ok: false, error: { code: 'invalid_status', message: 'Post 3 is draft' } },
      ],
    });
    for (const id of [1, 2]) {
      const post = await getPost(id);
      expect(post.status).toBe('draft');
      expect(post.last_error).toBeNull();
      expect(post.retry_count).toBe(0);
    }
  });

  test('published rejects promote and demote', async () => {
    // Given: a published post
    await createPost({ text: 'Old' });
    setPost(1, { status: 'published' });

    // When: promoting and demoting it
    const promoted = await postStatus('/api/posts/promote', [1]);
    const demoted = await postStatus('/api/posts/demote', [1]);

    // Then: both report invalid_status
    for (const response of [promoted, demoted]) {
      expect(response).toEqual({
        results: [
          {
            id: 1,
            ok: false,
            error: { code: 'invalid_status', message: 'Post 1 is published' },
          },
        ],
      });
    }
  });

  test('schedules a draft and an official post', async () => {
    // Given: a draft and an official post
    await createPost({ text: 'Hello' });
    await createPost({ text: 'Two' });
    await postStatus('/api/posts/promote', [2]);

    // When: scheduling the draft by date-time and the official post relatively
    const draft = await request('/api/posts/1/schedule', {
      method: 'POST',
      body: JSON.stringify({ at: '2026-09-10 09:00' }),
    });
    const official = await request('/api/posts/2/schedule', {
      method: 'POST',
      body: JSON.stringify({ at: '+2h' }),
    });

    // Then: both hold a schedule
    expect(draft.status).toBe(200);
    const draftPost = (await draft.json()) as Post;
    expect(draftPost.scheduled_at).toBe('2026-09-10T09:00:00.000Z');
    expect(draftPost.status).toBe('draft');
    expect(official.status).toBe(200);
    const officialPost = (await official.json()) as Post;
    expect(officialPost.scheduled_at).toBe('2026-09-04T12:00:00.000Z');
    expect(officialPost.status).toBe('official');
  });

  test('rejects a past time without force', async () => {
    // Given: a draft
    await createPost({ text: 'Hi' });

    // When: scheduling it in the past, then with force
    const past = await request('/api/posts/1/schedule', {
      method: 'POST',
      body: JSON.stringify({ at: '2026-09-01 09:00' }),
    });

    // Then: the plain past time is refused
    expect(past.status).toBe(400);
    expect(await past.json()).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'at', message: 'Time is in the past' }],
    });
    expect((await getPost(1)).scheduled_at).toBeNull();

    // When: the same time with force
    const forced = await request('/api/posts/1/schedule', {
      method: 'POST',
      body: JSON.stringify({ at: '2026-09-01 09:00', force: true }),
    });

    // Then: the forced one sticks
    expect(forced.status).toBe(200);
    expect(((await forced.json()) as Post).scheduled_at).toBe('2026-09-01T09:00:00.000Z');
  });

  test('rejects an unrecognised time', async () => {
    // Given: a draft
    await createPost({ text: 'Hi' });

    // When: scheduling with junk
    const response = await request('/api/posts/1/schedule', {
      method: 'POST',
      body: JSON.stringify({ at: 'soon' }),
    });

    // Then: `at` names the problem
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'at', message: 'Unrecognised time' }],
    });
  });

  test('published rejects schedule', async () => {
    // Given: a published post and a failed post
    await createPost({ text: 'Old' });
    await createPost({ text: 'Err' });
    setPost(1, { status: 'published' });
    setPost(2, { status: 'failed' });

    // When: scheduling each
    const published = await request('/api/posts/1/schedule', {
      method: 'POST',
      body: JSON.stringify({ at: '+2h' }),
    });
    const failed = await request('/api/posts/2/schedule', {
      method: 'POST',
      body: JSON.stringify({ at: '+2h' }),
    });

    // Then: both name the status
    expect(published.status).toBe(400);
    expect(await published.json()).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'status', message: 'Post 1 is published' }],
    });
    expect(failed.status).toBe(400);
    expect(await failed.json()).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'status', message: 'Post 2 is failed' }],
    });
  });

  test('round-trips a time in a non-UTC zone', async () => {
    // Given: the user's zone is Ho Chi Minh City and a draft exists
    const patched = await request('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ timezone: 'Asia/Ho_Chi_Minh' }),
    });
    expect(patched.status).toBe(200);
    await createPost({ text: 'Hi' });

    // When: scheduling a local wall-clock time
    const scheduled = await request('/api/posts/1/schedule', {
      method: 'POST',
      body: JSON.stringify({ at: '2026-09-10 09:00' }),
    });
    const got = await getPost(1);

    // Then: the stored instant is UTC and reads back as the same wall time
    expect(((await scheduled.json()) as Post).scheduled_at).toBe('2026-09-10T02:00:00.000Z');
    expect(got.scheduled_at).toBe('2026-09-10T02:00:00.000Z');
    expect(zonedParts(new Date(got.scheduled_at as string), 'Asia/Ho_Chi_Minh')).toEqual({
      date: '2026-09-10',
      time: '09:00',
      weekday: 4,
    });
  });

  test('unschedules in a batch with one bad id', async () => {
    // Given: a scheduled post and the seeded timed posts
    await seedTimedPosts();
    setPost(1, { scheduledAt: new Date('2026-09-10T09:00:00Z') });

    // When: unscheduling post 1, published post 5, and an unknown id
    const response = await postStatus('/api/posts/unschedule', [1, 5, 999]);

    // Then: each item reports its own result
    expect(response).toEqual({
      results: [
        { id: 1, ok: true },
        { id: 5, ok: false, error: { code: 'invalid_status', message: 'Post 5 is published' } },
        { id: 999, ok: false, error: { code: 'not_found', message: 'Post 999 not found' } },
      ],
    });
    expect((await getPost(1)).scheduled_at).toBeNull();
  });

  test('filters scheduled and unscheduled', async () => {
    // Given: timed posts with 3 and 4 scheduled
    await seedTimedPosts();

    // When: listing each filter
    const scheduled = await request('/api/posts?scheduled=true');
    const unscheduled = await request('/api/posts?scheduled=false');
    const bad = await request('/api/posts?scheduled=maybe');

    // Then: scheduled posts separate from the rest
    const scheduledBody = (await scheduled.json()) as PostList;
    expect(scheduledBody.items.map((post) => post.id).sort()).toEqual([3, 4]);
    expect(scheduledBody.total).toBe(2);
    const unscheduledBody = (await unscheduled.json()) as PostList;
    expect(unscheduledBody.items.map((post) => post.id).sort()).toEqual([1, 2, 5]);
    expect(unscheduledBody.total).toBe(3);
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe('validation');
  });

  test('creates an official post when the checks pass', async () => {
    // Given: nothing
    // When: creating with official and real text
    const created = await request('/api/posts', {
      method: 'POST',
      body: JSON.stringify({ text: 'Live', official: true }),
    });

    // Then: the post is official
    expect(created.status).toBe(201);
    expect(((await created.json()) as Post).status).toBe('official');

    // When: creating empty with official
    const empty = await request('/api/posts', {
      method: 'POST',
      body: JSON.stringify({ text: '', official: true }),
    });

    // Then: the failing checks are returned and nothing is created
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'text', message: 'Text is empty' }],
    });
  });

  test('get carries the ready checklist', async () => {
    // Given: a draft with one image and no account
    await uploadImage('a.png');
    await createPost({ text: 'Hello', from: [1] });
    const before = await getPost(1);
    expect(before.ready).toEqual({
      ok: false,
      checks: [
        { code: 'text', ok: true, label: 'Text is not empty' },
        { code: 'limit', ok: true, label: '5 of 280 characters' },
        { code: 'media', ok: true, label: '1 of 4 images' },
        { code: 'account', ok: false, label: 'No X account connected' },
      ],
    });

    // When: an account is connected
    connectAccount();
    const after = await getPost(1);

    // Then: the checklist flips to all green
    expect(after.ready.ok).toBe(true);
    expect(after.ready.checks[3]).toEqual({
      code: 'account',
      ok: true,
      label: 'X account connected',
    });
  });
});
