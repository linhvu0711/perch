import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';
import type { Post, PostList, Resource } from '@perch/core';
import { eq } from 'drizzle-orm';

import { openDb } from '../src/db';
import { postLinks, posts, xAccounts } from '../src/db/schema';
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

async function list(query = ''): Promise<PostList> {
  const response = await request(`/api/posts${query}`);
  expect(response.status).toBe(200);
  return (await response.json()) as PostList;
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

  test('seeds timed posts and lists time desc with untimed last', async () => {
    await seedTimedPosts();

    const result = await list();
    expect(result.items.map((item) => item.id)).toEqual([4, 5, 3, 2, 1]);
    expect(result.total).toBe(5);
    expect(result.next_cursor).toBeNull();
  });

  test('filters by status, search, date range, and resource', async () => {
    await createNote('# One');
    await seedTimedPosts();

    const { db, sqlite } = openDb(path.join(server.dir, 'perch.db'));
    db.insert(postLinks).values({ postId: 2, resourceId: 1 }).run();
    sqlite.close();

    expect((await list('?status=draft')).items.map((i) => i.id)).toEqual([4, 3, 2, 1]);
    expect((await list('?status=published')).items.map((i) => i.id)).toEqual([5]);
    expect((await list('?search=banana')).items.map((i) => i.id)).toEqual([1]);
    expect((await list('?search=BANANA')).items.map((i) => i.id)).toEqual([1]);
    expect(
      (await list('?from=2026-09-11&to=2026-09-12')).items.map((i) => i.id),
    ).toEqual([4, 5]);
    expect((await list('?from=2026-09-12')).items.map((i) => i.id)).toEqual([4]);
    expect((await list('?to=2026-09-10')).items.map((i) => i.id)).toEqual([3]);
    expect((await list('?resource_id=1')).items.map((i) => i.id)).toEqual([2]);

    const badDate = await request('/api/posts?from=2026-9-1');
    expect(badDate.status).toBe(400);
  });

  test('pages with a stable cursor', async () => {
    await seedTimedPosts();

    const page1 = await list('?limit=2');
    expect(page1.items.map((i) => i.id)).toEqual([4, 5]);
    const page2 = await list(`?limit=2&cursor=${page1.next_cursor}`);
    expect(page2.items.map((i) => i.id)).toEqual([3, 2]);
    const page3 = await list(`?limit=2&cursor=${page2.next_cursor}`);
    expect(page3.items.map((i) => i.id)).toEqual([1]);
    expect(page3.next_cursor).toBeNull();

    const badCursor = await request('/api/posts?cursor=garbage');
    expect(badCursor.status).toBe(400);
    expect(await badCursor.json()).toMatchObject({
      code: 'validation',
      errors: [{ path: 'cursor', message: 'Invalid cursor' }],
    });

    const badLimit = await request('/api/posts?limit=101');
    expect(badLimit.status).toBe(400);
  });

  test('falls back to the first line of text in lists', async () => {
    await createPost({ text: 'banana split\nsecond line' });
    await createPost({ title: 'Named', text: 'body' });
    await createPost({});

    const result = await list();
    expect(result.items.map((i) => i.title)).toEqual(['', 'Named', 'banana split']);

    const got = await request('/api/posts/1');
    expect(got.status).toBe(200);
    expect((await got.json()).title).toBe('');
  });

  test('patches title and text', async () => {
    await createPost({ text: 'old' });
    server.clock.set(new Date('2026-09-04T11:00:00Z'));

    const patched = await request('/api/posts/1', {
      method: 'PATCH',
      body: JSON.stringify({ text: 'new', title: 'T' }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      text: 'new',
      title: 'T',
      created_at: '2026-09-04T10:00:00.000Z',
      updated_at: '2026-09-04T11:00:00.000Z',
      character_count: 3,
    });

    const empty = await request('/api/posts/1', {
      method: 'PATCH',
      body: '{}',
    });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ code: 'validation' });

    const missing = await request('/api/posts/999', {
      method: 'PATCH',
      body: JSON.stringify({ text: 'x' }),
    });
    expect(missing.status).toBe(404);
  });

  test('links and unlinks in batches with one bad id', async () => {
    await createNote('# One');
    await createNote('# Two');
    await createPost({});

    const link = () =>
      request('/api/posts/1/links', {
        method: 'POST',
        body: JSON.stringify({ resource_ids: [1, 999, 2] }),
      });
    const linked = await link();
    expect(linked.status).toBe(200);
    const expectedResults = {
      results: [
        { id: 1, ok: true },
        {
          id: 999,
          ok: false,
          error: { code: 'not_found', message: 'Resource 999 not found' },
        },
        { id: 2, ok: true },
      ],
    };
    expect(await linked.json()).toEqual(expectedResults);
    expect(await (await link()).json()).toEqual(expectedResults);

    const got = await request('/api/posts/1');
    expect((await got.json()).links).toEqual([
      { resource_id: 1, type: 'md', title: 'One' },
      { resource_id: 2, type: 'md', title: 'Two' },
    ]);

    const unlinked = await request('/api/posts/1/links', {
      method: 'DELETE',
      body: JSON.stringify({ resource_ids: [2, 999] }),
    });
    expect(unlinked.status).toBe(200);
    expect(await unlinked.json()).toEqual({
      results: [
        { id: 2, ok: true },
        {
          id: 999,
          ok: false,
          error: { code: 'not_found', message: 'Resource 999 not found' },
        },
      ],
    });
    expect((await (await request('/api/posts/1')).json()).links).toEqual([
      { resource_id: 1, type: 'md', title: 'One' },
    ]);

    const unlinkedAgain = await request('/api/posts/1/links', {
      method: 'DELETE',
      body: JSON.stringify({ resource_ids: [2] }),
    });
    expect(await unlinkedAgain.json()).toEqual({
      results: [{ id: 2, ok: true }],
    });

    const missingPost = await request('/api/posts/999/links', {
      method: 'POST',
      body: JSON.stringify({ resource_ids: [1] }),
    });
    expect(missingPost.status).toBe(404);

    const emptyIds = await request('/api/posts/1/links', {
      method: 'POST',
      body: JSON.stringify({ resource_ids: [] }),
    });
    expect(emptyIds.status).toBe(400);
  });

  test('deletes in batches and never calls X', async () => {
    await createNote('# One');
    await createPost({});
    await createPost({});
    await request('/api/posts/1/links', {
      method: 'POST',
      body: JSON.stringify({ resource_ids: [1] }),
    });

    const deleted = await request('/api/posts', {
      method: 'DELETE',
      body: JSON.stringify({ ids: [1, 999, 2] }),
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({
      results: [
        { id: 1, ok: true },
        {
          id: 999,
          ok: false,
          error: { code: 'not_found', message: 'Post 999 not found' },
        },
        { id: 2, ok: true },
      ],
    });

    expect((await request('/api/posts/1')).status).toBe(404);
    const resource = await request('/api/resources/1');
    expect(resource.status).toBe(200);

    const empty = await request('/api/posts', {
      method: 'DELETE',
      body: JSON.stringify({ ids: [] }),
    });
    expect(empty.status).toBe(400);

    expect(server.xClient.calls).toEqual([]);
  });

  test('rejects edits and link changes on published posts', async () => {
    await createNote('# One');
    await seedTimedPosts();

    const patched = await request('/api/posts/5', {
      method: 'PATCH',
      body: JSON.stringify({ text: 'changed' }),
    });
    expect(patched.status).toBe(400);
  });

  test('reports the connected Premium plan limit', async () => {
    await createPost({ text: 'hi' });
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

    const post = await request('/api/posts/1');
    expect((await post.json()).limit).toBe(25_000);
  });

  test('rejects link changes on published posts', async () => {
    await createNote('# One');
    await seedTimedPosts();

    const linked = await request('/api/posts/5/links', {
      method: 'POST',
      body: JSON.stringify({ resource_ids: [1] }),
    });
    expect(linked.status).toBe(400);

    const unlinked = await request('/api/posts/5/links', {
      method: 'DELETE',
      body: JSON.stringify({ resource_ids: [1] }),
    });
    expect(unlinked.status).toBe(400);
  });

  test('previews as segments', async () => {
    await createPost({ text: 'Check https://x.com @bob #news' });

    const preview = await request('/api/posts/1/preview');
    expect(preview.status).toBe(200);
    expect(await preview.json()).toEqual({
      segments: [
        { kind: 'text', text: 'Check ' },
        { kind: 'url', text: 'https://x.com' },
        { kind: 'text', text: ' ' },
        { kind: 'mention', text: '@bob' },
        { kind: 'text', text: ' ' },
        { kind: 'hashtag', text: '#news' },
      ],
      character_count: 40,
      limit: 280,
      estimated_cost: 0.2,
    });

    const missing = await request('/api/posts/999/preview');
    expect(missing.status).toBe(404);
  });
});
