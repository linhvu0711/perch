import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import type { Post, PostList, PostMediaAttachResponse, Resource } from '@perch/core';
import { eq } from 'drizzle-orm';

import { openDb } from '../src/db';
import { posts } from '../src/db/schema';
import {
  connectTestAccount,
  createTestServer,
  JPG_3X2,
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
      present: true,
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
          media: {
            id: 1,
            position: 1,
            mime: 'image/png',
            bytes: 73,
            from_resource_id: 2,
            present: true,
          },
        },
      ],
    });
  });

  test('reports a missing image file per item and writes nothing', async () => {
    // Given: an image resource whose file is deleted, and one post
    const [imageId] = await uploadImages({ name: 'a.png', bytes: PNG_3X2 });
    if (imageId === undefined) throw new Error('upload failed');
    const resources = await request(`/api/resources/${imageId}`);
    const resource = (await resources.json()) as Resource;
    if (resource.type !== 'image') throw new Error('not an image');
    fs.unlinkSync(path.join(server.dir, 'uploads', resource.path));
    await createPost({ text: 'Hi' });

    // When: attaching the resource to the post
    const response = await attachMedia(1, [imageId]);

    // Then: the item fails, and nothing is stored, linked, or recorded
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [
        {
          id: imageId,
          ok: false,
          error: { code: 'file_missing', message: 'Image file is missing' },
        },
      ],
    });
    expect(mediaFiles(1)).toHaveLength(0);
    const post = await getPost(1);
    expect(post.media).toEqual([]);
    expect(post.links).toEqual([]);
    expect(server.r2.calls).toEqual([{ name: 'put', key: `uploads/${resource.path}` }]);
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
      { id: 1, position: 1, mime: 'image/png', bytes: 73, from_resource_id: null, present: true },
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
          media: {
            id: 1,
            position: 1,
            mime: 'image/jpeg',
            bytes: 777,
            from_resource_id: null,
            present: true,
          },
        },
      ],
    });
    const post = await getPost(1);
    expect(post.media).toHaveLength(1);
    const copies = mediaFiles(1);
    expect(copies).toHaveLength(1);
    expect(fs.statSync(path.join(mediaDir(1), copies[0] as string)).size).toBe(777);
  });

  test('copies attached media to R2', async () => {
    // Given: a post and a file uploaded straight to it
    await createPost({ text: 'Hi' });
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

    // When: the stored media path is read
    expect(response.status).toBe(200);
    const rel = `1/posts/1/${mediaFiles(1)[0]}`;

    // Then: one put copied the bytes under uploads/<rel>
    expect(server.r2.calls).toEqual([{ name: 'put', key: `uploads/${rel}` }]);
  });

  test('keeps the media when the R2 copy fails', async () => {
    // Given: the R2 client throws, then a file uploaded to a post
    server.r2.putError = new Error('r2 down');
    await createPost({ text: 'Hi' });
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

    // Then: the media row and file survive and the failure is logged
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      results: Array<{ ok: boolean; media?: { id: number } }>;
    };
    expect(body.results[0]?.media?.id).toBe(1);
    expect(mediaFiles(1)).toHaveLength(1);
    expect((server.errors[0] as Error).message).toBe('r2 down');
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
    const body = (await response.json()) as Post;
    expect(body.id).toBe(1);
    expect(body.media.map((m) => m.position)).toEqual([1, 2]);
    const post = await getPost(1);
    expect(post.media.map((m) => [m.position, m.from_resource_id])).toEqual([
      [1, 1],
      [2, 3],
    ]);
    expect(mediaFiles(1)).toHaveLength(2);
  });

  test('keeps positions contiguous when a detach lands during an attach', async () => {
    // Given: four images, a post with media at positions 1-3, and a held file write
    await uploadImages(
      { name: 'a.png', bytes: PNG_3X2 },
      { name: 'b.png', bytes: PNG_3X2 },
      { name: 'c.png', bytes: PNG_3X2 },
      { name: 'd.png', bytes: PNG_3X2 },
    );
    await createPost({ text: 'Hi' });
    expect((await attachMedia(1, [1, 2, 3])).status).toBe(200);
    let resolveEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      resolveEntered = resolve;
    });
    let resolveRelease!: () => void;
    const release = new Promise<void>((resolve) => {
      resolveRelease = resolve;
    });
    let calls = 0;
    const realWrite = Bun.write.bind(Bun);
    const write = spyOn(Bun, 'write');
    write.mockImplementation((...args) => {
      calls += 1;
      const call = () => realWrite(args[0] as string, args[1] as Uint8Array);
      if (calls === 1) {
        resolveEntered();
        return release.then(call);
      }
      return call();
    });

    // When: a detach of position 2 lands while an attach is still writing its file
    const held = attachMedia(1, [4]);
    await entered;
    const detach = await request('/api/posts/1/media', {
      method: 'DELETE',
      body: JSON.stringify({ positions: [2] }),
    });
    resolveRelease();
    const attach = await held;
    write.mockRestore();

    // Then: the attach lands at position 3 and the next attach gets position 4
    expect(detach.status).toBe(200);
    const detachBody = (await detach.json()) as Post;
    expect(detachBody.media.map((m) => m.position)).toEqual([1, 2]);
    expect(attach.status).toBe(200);
    expect((await getPost(1)).media.map((m) => m.position)).toEqual([1, 2, 3]);
    const retry = await attachMedia(1, [2]);
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as PostMediaAttachResponse;
    const retryMedia = retryBody.results[0];
    expect(retryMedia?.ok).toBe(true);
    expect(retryMedia?.ok && retryMedia.media.position).toBe(4);
    expect((await getPost(1)).media.map((m) => m.position)).toEqual([1, 2, 3, 4]);
    expect(mediaFiles(1)).toHaveLength(4);
  });

  test('keeps positions contiguous when two attaches overlap', async () => {
    // Given: four images, a post with two media, and a held file write
    await uploadImages(
      { name: 'a.png', bytes: PNG_3X2 },
      { name: 'b.png', bytes: PNG_3X2 },
      { name: 'c.png', bytes: PNG_3X2 },
      { name: 'd.png', bytes: PNG_3X2 },
    );
    await createPost({ text: 'Hi' });
    expect((await attachMedia(1, [1, 2])).status).toBe(200);
    let resolveEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      resolveEntered = resolve;
    });
    let resolveRelease!: () => void;
    const release = new Promise<void>((resolve) => {
      resolveRelease = resolve;
    });
    let calls = 0;
    const realWrite = Bun.write.bind(Bun);
    const write = spyOn(Bun, 'write');
    write.mockImplementation((...args) => {
      calls += 1;
      const call = () => realWrite(args[0] as string, args[1] as Uint8Array);
      if (calls === 1) {
        resolveEntered();
        return release.then(call);
      }
      return call();
    });

    // When: a second attach lands while the first is still writing its file
    const held = attachMedia(1, [3]);
    await entered;
    const first = await attachMedia(1, [4]);
    resolveRelease();
    const second = await held;
    write.mockRestore();

    // Then: both attach and positions stay contiguous
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as PostMediaAttachResponse;
    const firstMedia = firstBody.results[0];
    expect(firstMedia?.ok && firstMedia.media.position).toBe(3);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as PostMediaAttachResponse;
    const secondMedia = secondBody.results[0];
    expect(secondMedia?.ok && secondMedia.media.position).toBe(4);
    expect((await getPost(1)).media.map((m) => m.position)).toEqual([1, 2, 3, 4]);
    expect(mediaFiles(1)).toHaveLength(4);
  });

  test('refuses the fifth media when another attach lands first', async () => {
    // Given: five images, a post with three media, and a held file write
    await uploadImages(
      { name: 'a.png', bytes: PNG_3X2 },
      { name: 'b.png', bytes: PNG_3X2 },
      { name: 'c.png', bytes: PNG_3X2 },
      { name: 'd.png', bytes: PNG_3X2 },
      { name: 'e.png', bytes: PNG_3X2 },
    );
    await createPost({ text: 'Hi' });
    expect((await attachMedia(1, [1, 2, 3])).status).toBe(200);
    let resolveEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      resolveEntered = resolve;
    });
    let resolveRelease!: () => void;
    const release = new Promise<void>((resolve) => {
      resolveRelease = resolve;
    });
    let calls = 0;
    const realWrite = Bun.write.bind(Bun);
    const write = spyOn(Bun, 'write');
    write.mockImplementation((...args) => {
      calls += 1;
      const call = () => realWrite(args[0] as string, args[1] as Uint8Array);
      if (calls === 1) {
        resolveEntered();
        return release.then(call);
      }
      return call();
    });

    // When: a second attach lands while the first is still writing its file
    const held = attachMedia(1, [4]);
    await entered;
    const first = await attachMedia(1, [5]);
    resolveRelease();
    const second = await held;
    write.mockRestore();

    // Then: the second attach wins position 4 and the held attach names the limit
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as PostMediaAttachResponse;
    const firstMedia = firstBody.results[0];
    expect(firstMedia?.ok && firstMedia.media.position).toBe(4);
    expect(second.status).toBe(400);
    expect(await second.json()).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'resource_ids', message: 'At most 4 media per post' }],
    });
    expect((await getPost(1)).media.map((m) => m.position)).toEqual([1, 2, 3, 4]);
    expect(mediaFiles(1)).toHaveLength(4);
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
    expect(await response.json()).toMatchObject({ id: 1, media: [] });
    expect((await getPost(1)).media).toEqual([]);
    expect(mediaFiles(1)).toHaveLength(0);
  });

  test('detach keeps its 404 and 400 answers', async () => {
    // Given: no post 999

    // When: detaching from a missing post, then with a bad body
    const missing = await request('/api/posts/999/media', {
      method: 'DELETE',
      body: JSON.stringify({ positions: [1] }),
    });
    const bad = await request('/api/posts/999/media', {
      method: 'DELETE',
      body: JSON.stringify({}),
    });

    // Then: 404 not_found, then 400 validation
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      code: 'not_found',
      message: 'Post 999 not found',
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: 'validation' });
  });

  test('reports a missing position', async () => {
    // Given: a post with one media at position 1
    const ids = await uploadImages({ name: 'a.png', bytes: PNG_3X2 });
    await createPost({ text: 'Hi' });
    await attachMedia(1, ids);
    const file = path.join(mediaDir(1), mediaFiles(1)[0] as string);

    // When: detaching positions 1 and 3
    const response = await request('/api/posts/1/media', {
      method: 'DELETE',
      body: JSON.stringify({ positions: [1, 3] }),
    });

    // Then: the position error is named and nothing is deleted
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'positions', message: 'No media at position 3' }],
    });
    expect((await getPost(1)).media).toHaveLength(1);
    expect(fs.existsSync(file)).toBe(true);
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

  test('rejects post create when a from image file is missing', async () => {
    // Given: an image resource whose file is deleted
    const [imageId] = await uploadImages({ name: 'a.png', bytes: PNG_3X2 });
    if (imageId === undefined) throw new Error('upload failed');
    const resources = await request(`/api/resources/${imageId}`);
    const resource = (await resources.json()) as Resource;
    if (resource.type !== 'image') throw new Error('not an image');
    fs.unlinkSync(path.join(server.dir, 'uploads', resource.path));

    // When: creating a post from it
    const response = await request('/api/posts', {
      method: 'POST',
      body: JSON.stringify({ text: 'Hi', from: [imageId] }),
    });

    // Then: the create is rejected and leaves no post or files behind
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'from', message: 'Image file is missing' }],
    });
    expect((await request('/api/posts/1')).status).toBe(404);
    expect(fs.existsSync(mediaDir(1))).toBe(false);
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
      { id: 1, position: 1, mime: 'image/png', bytes: 73, from_resource_id: 1, present: true },
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

  test('every Media item carries present on get, list, calendar, and status', async () => {
    // Given: a connected account and a scheduled post with one attached image
    connectTestAccount(server);
    await createPost({ text: 'Hi' });
    const [imageId] = await uploadImages({ name: 'a.png', bytes: PNG_3X2 });
    if (imageId === undefined) throw new Error('upload failed');
    await attachMedia(1, [imageId]);
    const scheduled = await request('/api/posts/1/schedule', {
      method: 'POST',
      body: JSON.stringify({ at: '2026-09-10 09:00' }),
    });
    expect(scheduled.status).toBe(200);

    // When: reading the post back on every surface, before and after the file is removed
    const read = async () => {
      const post = await getPost(1);
      const list = (await (await request('/api/posts')).json()) as PostList;
      const calendar = (await (
        await request('/api/calendar?from=2026-09-01&to=2026-09-30')
      ).json()) as { days: Array<{ posts: Post[] }> };
      const status = (await (await request('/api/status')).json()) as {
        next_due: Post[];
      };
      return [
        post.media[0]?.present,
        list.items[0]?.media[0]?.present,
        calendar.days[0]?.posts[0]?.media[0]?.present,
        status.next_due[0]?.media[0]?.present,
      ];
    };
    const before = await read();
    for (const file of fs.readdirSync(mediaDir(1))) {
      fs.unlinkSync(path.join(mediaDir(1), file));
    }
    const after = await read();

    // Then: present tracks the file on disk
    expect(before).toEqual([true, true, true, true]);
    expect(after).toEqual([false, false, false, false]);
  });

  test('attach and detach responses carry present', async () => {
    // Given: a post and one image resource
    await createPost({ text: 'Hi' });
    const [imageId] = await uploadImages({ name: 'a.png', bytes: PNG_3X2 });
    if (imageId === undefined) throw new Error('upload failed');

    // When: attaching the resource, attaching an uploaded file, then detaching the first
    const attached = await attachMedia(1, [imageId]);
    const form = new FormData();
    form.append(
      'files',
      new File([PNG_3X2.slice().buffer as ArrayBuffer], 'c.png', { type: 'image/png' }),
    );
    const fileAttached = await request('/api/posts/1/media/files', {
      method: 'POST',
      body: form,
    });
    const detached = await request('/api/posts/1/media', {
      method: 'DELETE',
      body: JSON.stringify({ positions: [1] }),
    });

    // Then: every returned Media item carries present: true
    expect(await attached.json()).toEqual({
      results: [
        {
          id: 1,
          ok: true,
          media: {
            id: 1,
            position: 1,
            mime: 'image/png',
            bytes: 73,
            from_resource_id: 1,
            present: true,
          },
        },
      ],
    });
    const fileBody = (await fileAttached.json()) as {
      results: Array<{ ok: boolean; media?: { present: boolean } }>;
    };
    expect(fileBody.results[0]?.media?.present).toBe(true);
    expect(await detached.json()).toMatchObject({
      media: [
        {
          id: 2,
          position: 1,
          mime: 'image/png',
          bytes: 73,
          from_resource_id: null,
          present: true,
        },
      ],
    });
  });

  test('attaches nothing when the second resource write throws', async () => {
    // Given: three images, one post, and one media already attached
    await uploadImages(
      { name: 'a.png', bytes: PNG_3X2 },
      { name: 'b.png', bytes: PNG_3X2 },
      { name: 'c.png', bytes: PNG_3X2 },
    );
    await createPost({ text: 'Hi' });
    expect((await attachMedia(1, [1])).status).toBe(200);
    const before = await getPost(1);
    const filesBefore = mediaFiles(1);
    let calls = 0;
    const realMkdir = fs.mkdirSync.bind(fs);
    const mkdir = spyOn(fs, 'mkdirSync');
    mkdir.mockImplementation((...args) => {
      calls += 1;
      if (calls === 2) throw new Error('disk full');
      return realMkdir(...args);
    });

    // When: attaching two more resources and the second store throws
    const response = await attachMedia(1, [2, 3]);
    mkdir.mockRestore();

    // Then: the request fails and the post keeps its one media, link, and file
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'internal', message: 'Internal error' });
    const post = await getPost(1);
    expect(post.media).toEqual([
      { id: 1, position: 1, mime: 'image/png', bytes: 73, from_resource_id: 1, present: true },
    ]);
    expect(post.links).toEqual(before.links);
    expect(mediaFiles(1)).toEqual(filesBefore);
  });

  test('uploads nothing to R2 when the second resource write throws', async () => {
    // Given: three images, one post, and one media already attached
    await uploadImages(
      { name: 'a.png', bytes: PNG_3X2 },
      { name: 'b.png', bytes: PNG_3X2 },
      { name: 'c.png', bytes: PNG_3X2 },
    );
    await createPost({ text: 'Hi' });
    expect((await attachMedia(1, [1])).status).toBe(200);
    server.r2.calls.length = 0;
    const objectsBefore = server.r2.objects.size;
    let calls = 0;
    const realMkdir = fs.mkdirSync.bind(fs);
    const mkdir = spyOn(fs, 'mkdirSync');
    mkdir.mockImplementation((...args) => {
      calls += 1;
      if (calls === 2) throw new Error('disk full');
      return realMkdir(...args);
    });

    // When: attaching two more resources and the second store throws
    const response = await attachMedia(1, [2, 3]);
    mkdir.mockRestore();

    // Then: the request fails and no R2 copy ran
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'internal', message: 'Internal error' });
    expect(server.r2.calls.filter((call) => call.name === 'put')).toEqual([]);
    expect(server.r2.objects.size).toBe(objectsBefore);
  });

  test('attaches nothing when the second file write throws', async () => {
    // Given: a post with one media already attached by file
    await createPost({ text: 'Hi' });
    const first = new FormData();
    first.append(
      'files',
      new File([PNG_3X2.slice().buffer as ArrayBuffer], 'a.png', { type: 'image/png' }),
    );
    expect(
      (await request('/api/posts/1/media/files', { method: 'POST', body: first })).status,
    ).toBe(200);
    const filesBefore = mediaFiles(1);
    let calls = 0;
    const realMkdir = fs.mkdirSync.bind(fs);
    const mkdir = spyOn(fs, 'mkdirSync');
    mkdir.mockImplementation((...args) => {
      calls += 1;
      if (calls === 2) throw new Error('disk full');
      return realMkdir(...args);
    });

    // When: attaching two more files and the second store throws
    const form = new FormData();
    form.append(
      'files',
      new File([PNG_3X2.slice().buffer as ArrayBuffer], 'b.png', { type: 'image/png' }),
    );
    form.append(
      'files',
      new File([PNG_3X2.slice().buffer as ArrayBuffer], 'c.png', { type: 'image/png' }),
    );
    const response = await request('/api/posts/1/media/files', { method: 'POST', body: form });
    mkdir.mockRestore();

    // Then: the request fails and the post keeps its one media and file
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'internal', message: 'Internal error' });
    const post = await getPost(1);
    expect(post.media).toEqual([
      { id: 1, position: 1, mime: 'image/png', bytes: 73, from_resource_id: null, present: true },
    ]);
    expect(mediaFiles(1)).toEqual(filesBefore);
  });

  test('uploads nothing to R2 when the second file write throws', async () => {
    // Given: a post with one media already attached by file
    await createPost({ text: 'Hi' });
    const first = new FormData();
    first.append(
      'files',
      new File([PNG_3X2.slice().buffer as ArrayBuffer], 'a.png', { type: 'image/png' }),
    );
    expect(
      (await request('/api/posts/1/media/files', { method: 'POST', body: first })).status,
    ).toBe(200);
    server.r2.calls.length = 0;
    const objectsBefore = server.r2.objects.size;
    let calls = 0;
    const realMkdir = fs.mkdirSync.bind(fs);
    const mkdir = spyOn(fs, 'mkdirSync');
    mkdir.mockImplementation((...args) => {
      calls += 1;
      if (calls === 2) throw new Error('disk full');
      return realMkdir(...args);
    });

    // When: attaching two more files and the second store throws
    const form = new FormData();
    form.append(
      'files',
      new File([PNG_3X2.slice().buffer as ArrayBuffer], 'b.png', { type: 'image/png' }),
    );
    form.append(
      'files',
      new File([PNG_3X2.slice().buffer as ArrayBuffer], 'c.png', { type: 'image/png' }),
    );
    const response = await request('/api/posts/1/media/files', { method: 'POST', body: form });
    mkdir.mockRestore();

    // Then: the request fails and no R2 copy ran
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'internal', message: 'Internal error' });
    expect(server.r2.calls.filter((call) => call.name === 'put')).toEqual([]);
    expect(server.r2.objects.size).toBe(objectsBefore);
  });

  test('removes a file whose write rejects after it was created', async () => {
    // Given: a post and a Bun.write that writes three bytes to the destination, then rejects
    await createPost({ text: 'Hi' });
    const realWrite = Bun.write;
    const write = spyOn(Bun, 'write');
    write.mockImplementation(async (destination, _data) => {
      await realWrite(destination, new Uint8Array(3));
      throw new Error('ENOSPC');
    });

    // When: attaching one file
    const form = new FormData();
    form.append(
      'files',
      new File([PNG_3X2.slice().buffer as ArrayBuffer], 'a.png', { type: 'image/png' }),
    );
    const response = await request('/api/posts/1/media/files', { method: 'POST', body: form });
    write.mockRestore();

    // Then: the request fails and the partial file is gone
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'internal', message: 'Internal error' });
    expect(mediaFiles(1)).toEqual([]);
  });

  test('rolls back post create when the media copy throws', async () => {
    // Given: one image resource and a regular file where the media directory must be created
    const [imageId] = await uploadImages({ name: 'a.png', bytes: PNG_3X2 });
    if (imageId === undefined) throw new Error('upload failed');
    const blocker = path.join(server.dir, 'uploads', '1', 'posts');
    fs.mkdirSync(path.join(server.dir, 'uploads', '1'), { recursive: true });
    fs.writeFileSync(blocker, '');

    // When: creating a post from the image, then clearing the blocker and retrying
    const failed = await request('/api/posts', {
      method: 'POST',
      body: JSON.stringify({ text: 'Hi', from: [imageId] }),
    });
    const firstList = (await (await request('/api/posts')).json()) as PostList;
    const blockerIsFile = fs.statSync(blocker).isFile();
    fs.rmSync(blocker);
    const created = await request('/api/posts', {
      method: 'POST',
      body: JSON.stringify({ text: 'Hi', from: [imageId] }),
    });
    const secondList = (await (await request('/api/posts')).json()) as PostList;

    // Then: the failed create left no post or directory, and the retry created one post
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ code: 'internal', message: 'Internal error' });
    expect(firstList.total).toBe(0);
    expect(blockerIsFile).toBe(true);
    expect(created.status).toBe(201);
    expect(secondList.total).toBe(1);
    expect(secondList.items[0]?.media).toHaveLength(1);
  });

  test('detaches the rows and logs a file that will not delete', async () => {
    // Given: a post with two media whose first file is now a non-empty directory
    await createPost({ text: 'Hi' });
    const first = new FormData();
    first.append(
      'files',
      new File([PNG_3X2.slice().buffer as ArrayBuffer], 'a.png', { type: 'image/png' }),
    );
    expect(
      (await request('/api/posts/1/media/files', { method: 'POST', body: first })).status,
    ).toBe(200);
    const [nameA] = mediaFiles(1);
    if (nameA === undefined) throw new Error('media file missing');
    const second = new FormData();
    second.append(
      'files',
      new File([PNG_3X2.slice().buffer as ArrayBuffer], 'b.png', { type: 'image/png' }),
    );
    expect(
      (await request('/api/posts/1/media/files', { method: 'POST', body: second })).status,
    ).toBe(200);
    const A = path.join(mediaDir(1), nameA);
    fs.rmSync(A);
    fs.mkdirSync(A);
    fs.writeFileSync(path.join(A, 'x'), '');

    // When: detaching position 1
    const response = await request('/api/posts/1/media', {
      method: 'DELETE',
      body: JSON.stringify({ positions: [1] }),
    });

    // Then: the row is gone, the kept media renumbers to 1, the error is logged, the file stays
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      media: [
        { id: 2, position: 1, mime: 'image/png', bytes: 73, from_resource_id: null, present: true },
      ],
    });
    expect(server.errors).toHaveLength(1);
    expect(fs.statSync(A).isDirectory()).toBe(true);
    expect(fs.readdirSync(mediaDir(1))).toHaveLength(2);
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
