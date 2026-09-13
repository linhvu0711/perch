import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import type { Post, PostMediaAttachResponse, Resource } from '@perch/core';
import { eq } from 'drizzle-orm';

import { openDb } from '../src/db';
import { posts } from '../src/db/schema';
import { createTestServer, JPG_3X2, PNG_3X2, type TestServer } from '../src/testing';

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

interface UploadFile {
  name: string;
  bytes: Uint8Array;
  type?: string;
}

async function upload(files: UploadFile[]): Promise<Response> {
  const form = new FormData();
  for (const file of files) {
    form.append(
      'files',
      new File([file.bytes.slice().buffer as ArrayBuffer], file.name, {
        type: file.type ?? '',
      }),
    );
  }
  return request('/api/resources/images', { method: 'POST', body: form });
}

async function uploadImages(...files: UploadFile[]): Promise<number[]> {
  const response = await upload(files);
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    results: Array<{ ok: boolean; resource?: Resource }>;
  };
  return body.results.map((result) => {
    expect(result.ok).toBe(true);
    if (!result.resource) throw new Error('resource missing');
    return result.resource.id;
  });
}

async function attachMedia(postId: number, resourceIds: number[]): Promise<Response> {
  return request(`/api/posts/${postId}/media`, {
    method: 'POST',
    body: JSON.stringify({ resource_ids: resourceIds }),
  });
}

async function getPost(id: number): Promise<Post> {
  const response = await request(`/api/posts/${id}`);
  expect(response.status).toBe(200);
  return (await response.json()) as Post;
}

function mediaDir(postId: number): string {
  return path.join(server.dir, 'uploads', '1', 'posts', String(postId));
}

function mediaFiles(postId: number): string[] {
  const dir = mediaDir(postId);
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

function setPostStatus(id: number, status: 'draft' | 'official' | 'published' | 'failed'): void {
  const { db, sqlite } = openDb(path.join(server.dir, 'perch.db'));
  db.update(posts).set({ status }).where(eq(posts.id, id)).run();
  sqlite.close();
}

describe('post media', () => {
  test('attaches from a resource: copies the file, links it, and records the row', async () => {
    // Given: one image resource and one post
    const [imageId] = await uploadImages({ name: 'a.png', bytes: PNG_3X2 });
    if (imageId === undefined) throw new Error('upload failed');
    await createPost({ text: 'Hi' });

    // When: attaching the resource to the post
    const response = await attachMedia(1, [imageId]);

    // Then: the media row is returned, the resource is linked, and a copy sits in the post directory
    expect(response.status).toBe(200);
    const media = {
      id: 1,
      position: 1,
      mime: 'image/png' as const,
      bytes: 73,
      from_resource_id: 1,
    };
    expect(await response.json()).toEqual({ results: [{ id: 1, ok: true, media }] });

    const post = await getPost(1);
    expect(post.links).toEqual([{ resource_id: 1, type: 'image', title: 'a.png' }]);
    expect(post.media).toEqual([media]);

    const copies = mediaFiles(1);
    expect(copies).toHaveLength(1);
    expect(fs.statSync(path.join(mediaDir(1), copies[0] as string)).size).toBe(73);

    const resources = await request('/api/resources/1');
    const resource = (await resources.json()) as Resource;
    if (resource.type !== 'image') throw new Error('not an image');
    expect(fs.existsSync(path.join(server.dir, 'uploads', resource.path))).toBe(true);
  });

  test('rejects a fifth media and names the limit', async () => {
    // Given: five image resources and one post
    const ids = await uploadImages(
      { name: 'a.png', bytes: PNG_3X2 },
      { name: 'b.png', bytes: PNG_3X2 },
      { name: 'c.png', bytes: PNG_3X2 },
      { name: 'd.png', bytes: PNG_3X2 },
      { name: 'e.png', bytes: PNG_3X2 },
    );
    const fifth = ids[4];
    if (fifth === undefined) throw new Error('upload failed');
    await createPost({ text: 'Hi' });

    // When: attaching four then one more
    const first = await attachMedia(1, ids.slice(0, 4));
    const second = await attachMedia(1, [fifth]);

    // Then: the first four attach, the fifth names the limit
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as PostMediaAttachResponse;
    expect(firstBody.results.map((r) => r.ok && r.media.position)).toEqual([1, 2, 3, 4]);

    expect(second.status).toBe(400);
    expect(await second.json()).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'resource_ids', message: 'At most 4 media per post' }],
    });
    expect((await getPost(1)).media).toHaveLength(4);
    expect(mediaFiles(1)).toHaveLength(4);
  });

  test('reports a missing or non-image resource per item', async () => {
    // Given: a note, an image, and a post
    const note = await request('/api/resources/notes', {
      method: 'POST',
      body: JSON.stringify({ body: '# Idea' }),
    });
    expect(note.status).toBe(201);
    const [imageId] = await uploadImages({ name: 'a.png', bytes: PNG_3X2 });
    if (imageId === undefined) throw new Error('upload failed');
    await createPost({ text: 'Hi' });

    // When: attaching a missing id, the note, and the image
    const response = await attachMedia(1, [999, 1, imageId]);

    // Then: each item reports its own result
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [
        {
          id: 999,
          ok: false,
          error: { code: 'not_found', message: 'Resource 999 not found' },
        },
        {
          id: 1,
          ok: false,
          error: { code: 'not_image', message: 'Resource 1 is not an image' },
        },
        {
          id: 2,
          ok: true,
          media: { id: 1, position: 1, mime: 'image/png', bytes: 73, from_resource_id: 2 },
        },
      ],
    });
  });

  test('deleting the source resource keeps the copy and nulls from_resource_id', async () => {
    // Given: an image attached to a post
    await uploadImages({ name: 'a.png', bytes: PNG_3X2 });
    await createPost({ text: 'Hi' });
    await attachMedia(1, [1]);
    const full = path.join(mediaDir(1), mediaFiles(1)[0] as string);

    // When: the resource is deleted
    const deleted = await request('/api/resources', {
      method: 'DELETE',
      body: JSON.stringify({ ids: [1] }),
    });

    // Then: the post's copy and row survive, unlinked and null-sourced
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({
      results: [{ id: 1, ok: true, unlinked_post_ids: [1] }],
    });
    expect(fs.existsSync(full)).toBe(true);
    const post = await getPost(1);
    expect(post.links).toEqual([]);
    expect(post.media).toEqual([
      { id: 1, position: 1, mime: 'image/png', bytes: 73, from_resource_id: null },
    ]);
  });

  test('accepts no alt text field', async () => {
    // Given: an image resource and a post
    await uploadImages({ name: 'a.png', bytes: PNG_3X2 });
    await createPost({ text: 'Hi' });

    // When: the attach body carries an alt key
    const response = await request('/api/posts/1/media', {
      method: 'POST',
      body: JSON.stringify({ resource_ids: [1], alt: 'a cat' }),
    });

    // Then: the request is rejected and nothing attaches
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('validation');
    expect(JSON.stringify(body)).toContain('alt');
    expect((await getPost(1)).media).toEqual([]);
  });

  test('rejects attach on a published post', async () => {
    // Given: a published post and an image resource
    await createPost({ text: 'Hi' });
    setPostStatus(1, 'published');
    await uploadImages({ name: 'a.png', bytes: PNG_3X2 });

    // When: attaching
    const response = await attachMedia(1, [1]);

    // Then: the post is immutable
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'status', message: 'Post 1 is published' }],
    });
  });

  test('attaches an uploaded file: stores it and records the row', async () => {
    // Given: a post
    await createPost({ text: 'Hi' });

    // When: uploading a file straight to the post
    const form = new FormData();
    form.append(
      'files',
      new File([JPG_3X2.slice().buffer as ArrayBuffer], 'photo.jpg', {
        type: 'image/jpeg',
      }),
    );
    const response = await request('/api/posts/1/media/files', {
      method: 'POST',
      body: form,
    });

    // Then: a media row is created at position 1
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [
        {
          name: 'photo.jpg',
          ok: true,
          media: { id: 1, position: 1, mime: 'image/jpeg', bytes: 777, from_resource_id: null },
        },
      ],
    });
    const post = await getPost(1);
    expect(post.media).toHaveLength(1);
    const copies = mediaFiles(1);
    expect(copies).toHaveLength(1);
    expect(fs.statSync(path.join(mediaDir(1), copies[0] as string)).size).toBe(777);
  });

  test('rejects a non-image file', async () => {
    // Given: a post
    await createPost({ text: 'Hi' });

    // When: uploading a text file
    const form = new FormData();
    form.append('files', new File(['hello'], 'note.txt', { type: 'text/plain' }));
    const response = await request('/api/posts/1/media/files', {
      method: 'POST',
      body: form,
    });

    // Then: the file reports a per-item failure
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [
        {
          name: 'note.txt',
          ok: false,
          error: { code: 'bad_type', message: 'Only PNG, JPG, WebP, or GIF' },
        },
      ],
    });
    expect((await getPost(1)).media).toEqual([]);
  });

  test('detaches media by position and renumbers', async () => {
    // Given: a post with three media
    const ids = await uploadImages(
      { name: 'a.png', bytes: PNG_3X2 },
      { name: 'b.png', bytes: PNG_3X2 },
      { name: 'c.png', bytes: PNG_3X2 },
    );
    await createPost({ text: 'Hi' });
    await attachMedia(1, ids);

    // When: detaching position 2
    const response = await request('/api/posts/1/media', {
      method: 'DELETE',
      body: JSON.stringify({ positions: [2] }),
    });

    // Then: the file is gone and positions renumber to 1,2
    expect(response.status).toBe(200);
    const body = (await response.json()) as { media: Post['media'] };
    expect(body.media.map((m) => m.position)).toEqual([1, 2]);
    const post = await getPost(1);
    expect(post.media.map((m) => [m.position, m.from_resource_id])).toEqual([
      [1, 1],
      [2, 3],
    ]);
    expect(mediaFiles(1)).toHaveLength(2);
  });

  test('detaches all media at once', async () => {
    // Given: a post with two media
    const ids = await uploadImages(
      { name: 'a.png', bytes: PNG_3X2 },
      { name: 'b.png', bytes: PNG_3X2 },
    );
    await createPost({ text: 'Hi' });
    await attachMedia(1, ids);

    // When: detaching all
    const response = await request('/api/posts/1/media', {
      method: 'DELETE',
      body: JSON.stringify({ all: true }),
    });

    // Then: every row and file is gone
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ media: [] });
    expect((await getPost(1)).media).toEqual([]);
    expect(mediaFiles(1)).toHaveLength(0);
  });

  test('reports a missing position', async () => {
    // Given: a post with one media at position 1
    const ids = await uploadImages({ name: 'a.png', bytes: PNG_3X2 });
    await createPost({ text: 'Hi' });
    await attachMedia(1, ids);

    // When: detaching position 3
    const response = await request('/api/posts/1/media', {
      method: 'DELETE',
      body: JSON.stringify({ positions: [3] }),
    });

    // Then: the position error is named
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'positions', message: 'No media at position 3' }],
    });
    expect((await getPost(1)).media).toHaveLength(1);
  });

  test('serves a media file', async () => {
    // Given: a post with one media
    const ids = await uploadImages({ name: 'a.png', bytes: PNG_3X2 });
    await createPost({ text: 'Hi' });
    await attachMedia(1, ids);
    const post = await getPost(1);
    const mediaId = post.media[0]?.id;

    // When: fetching the file
    const response = await request(`/api/posts/1/media/${mediaId}/file`);

    // Then: the stored bytes come back with the mime
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_3X2);
  });

  test('attaches image resources on post create', async () => {
    // Given: an image and a note
    await uploadImages({ name: 'a.png', bytes: PNG_3X2 });
    const note = await request('/api/resources/notes', {
      method: 'POST',
      body: JSON.stringify({ body: '# Idea' }),
    });
    expect(note.status).toBe(201);

    // When: creating a post from both
    const post = await createPost({ text: 'Hi', from: [1, 2] });

    // Then: the image attaches as media, both are linked
    expect(post.media).toEqual([
      { id: 1, position: 1, mime: 'image/png', bytes: 73, from_resource_id: 1 },
    ]);
    expect(post.links).toHaveLength(2);
    expect(mediaFiles(post.id)).toHaveLength(1);
  });

  test('rejects post create with more than four image resources', async () => {
    // Given: five images
    const ids = await uploadImages(
      { name: 'a.png', bytes: PNG_3X2 },
      { name: 'b.png', bytes: PNG_3X2 },
      { name: 'c.png', bytes: PNG_3X2 },
      { name: 'd.png', bytes: PNG_3X2 },
      { name: 'e.png', bytes: PNG_3X2 },
    );

    // When: creating a post from all five
    const response = await request('/api/posts', {
      method: 'POST',
      body: JSON.stringify({ text: 'Hi', from: ids }),
    });

    // Then: the limit is named on `from` and no post is created
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'from', message: 'At most 4 media per post' }],
    });
  });

  test('deleting a post removes its media files', async () => {
    // Given: a post with media
    const ids = await uploadImages({ name: 'a.png', bytes: PNG_3X2 });
    await createPost({ text: 'Hi' });
    await attachMedia(1, ids);
    expect(mediaFiles(1)).toHaveLength(1);

    // When: deleting the post
    const response = await request('/api/posts', {
      method: 'DELETE',
      body: JSON.stringify({ ids: [1] }),
    });

    // Then: the media directory is gone
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [{ id: 1, ok: true }] });
    expect(fs.existsSync(mediaDir(1))).toBe(false);
  });
});
