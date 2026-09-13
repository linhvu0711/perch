import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import type { ImageCreateResponse, Resource } from '@perch/core';
import {
  createTestServer,
  GIF_4X3,
  JPG_3X2,
  PNG_3X2,
  type TestServer,
  WEBP_3X2,
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

interface UploadFile {
  name: string;
  bytes: Uint8Array;
  type?: string;
}

async function upload(files: UploadFile[], title?: string): Promise<Response> {
  const form = new FormData();
  for (const file of files) {
    form.append(
      'files',
      new File([file.bytes.slice().buffer as ArrayBuffer], file.name, {
        type: file.type ?? '',
      }),
    );
  }
  if (title !== undefined) form.append('title', title);
  return request('/api/resources/images', { method: 'POST', body: form });
}

async function results(response: Response): Promise<ImageCreateResponse['results']> {
  expect(response.status).toBe(200);
  return ((await response.json()) as ImageCreateResponse).results;
}

describe('images', () => {
  test('uploads png, jpg, webp, and gif and records their facts', async () => {
    const rows = await results(
      await upload([
        { name: 'a.png', bytes: PNG_3X2 },
        { name: 'b.jpg', bytes: JPG_3X2 },
        { name: 'c.webp', bytes: WEBP_3X2 },
        { name: 'd.gif', bytes: GIF_4X3 },
      ]),
    );

    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      name: 'a.png',
      ok: true,
      resource: {
        id: 1,
        type: 'image',
        title: 'a.png',
        notes: '',
        created_at: '2026-09-04T10:00:00.000Z',
        path: rows[0]!.ok ? rows[0]!.resource.path : '',
        mime: 'image/png',
        bytes: 73,
        width: 3,
        height: 2,
      },
    });
    expect(rows[1]).toMatchObject({
      name: 'b.jpg',
      ok: true,
      resource: {
        id: 2,
        mime: 'image/jpeg',
        bytes: 777,
        width: 3,
        height: 2,
        path: rows[1]!.ok ? rows[1]!.resource.path : '',
      },
    });
    expect(rows[2]).toMatchObject({
      name: 'c.webp',
      ok: true,
      resource: { id: 3, mime: 'image/webp', bytes: 68, width: 3, height: 2 },
    });
    expect(rows[3]).toMatchObject({
      name: 'd.gif',
      ok: true,
      resource: { id: 4, mime: 'image/gif', bytes: 830, width: 4, height: 3 },
    });

    if (!rows[0]!.ok) throw new Error('upload failed');
    expect(rows[0]!.resource.path).toMatch(/^1\/[0-9a-f-]{36}\.png$/);
    if (!rows[1]!.ok) throw new Error('upload failed');
    expect(rows[1]!.resource.path).toMatch(/\.jpg$/);

    for (const row of rows) {
      if (!row.ok) throw new Error('upload failed');
      const full = path.join(server.dir, 'uploads', row.resource.path);
      expect(fs.statSync(full).size).toBe(row.resource.bytes);
    }

    const get = await request('/api/resources/1');
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(rows[0]!.ok ? rows[0]!.resource : null);
  });

  test('rejects oversized and wrong-type files per item and keeps the rest', async () => {
    const big = new Uint8Array(73 + 5 * 1024 * 1024);
    big.set(PNG_3X2);
    const exact = new Uint8Array(5 * 1024 * 1024);
    exact.set(PNG_3X2);

    const rows = await results(
      await upload([
        { name: 'big.png', bytes: big },
        { name: 'notes.txt', bytes: new TextEncoder().encode('hello') },
        {
          name: 'fake.png',
          bytes: new TextEncoder().encode('hello'),
          type: 'image/png',
        },
        { name: 'exact.png', bytes: exact },
        { name: 'ok.gif', bytes: GIF_4X3 },
      ]),
    );

    expect(rows).toEqual([
      {
        name: 'big.png',
        ok: false,
        error: { code: 'too_large', message: 'Over 5 MB' },
      },
      {
        name: 'notes.txt',
        ok: false,
        error: { code: 'bad_type', message: 'Only PNG, JPG, WebP, or GIF' },
      },
      {
        name: 'fake.png',
        ok: false,
        error: { code: 'bad_type', message: 'Only PNG, JPG, WebP, or GIF' },
      },
      {
        name: 'exact.png',
        ok: true,
        resource: expect.objectContaining({ id: 1, bytes: 5242880, width: 3, height: 2 }),
      },
      { name: 'ok.gif', ok: true, resource: expect.objectContaining({ id: 2 }) },
    ]);

    const list = await request('/api/resources');
    expect(await list.json()).toMatchObject({ total: 2 });
    expect(fs.readdirSync(path.join(server.dir, 'uploads', '1'))).toHaveLength(2);
  });

  test('defaults the title to the file name and lets title win for one file', async () => {
    const first = await results(await upload([{ name: 'holiday.png', bytes: PNG_3X2 }]));
    expect(first[0]).toMatchObject({ resource: { title: 'holiday.png' } });

    const second = await results(await upload([{ name: 'x.png', bytes: PNG_3X2 }], 'Beach'));
    expect(second[0]).toMatchObject({ resource: { title: 'Beach' } });

    const third = await upload(
      [
        { name: 'x.png', bytes: PNG_3X2 },
        { name: 'y.png', bytes: PNG_3X2 },
      ],
      'Beach',
    );
    expect(third.status).toBe(400);
    expect(await third.json()).toMatchObject({
      code: 'validation',
      errors: [{ path: 'title', message: 'title needs exactly one file' }],
    });

    const empty = await upload([]);
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({
      code: 'validation',
      errors: [{ path: 'files', message: 'At least one file is required' }],
    });
  });

  test('lists images with the type filter', async () => {
    await request('/api/resources/notes', {
      method: 'POST',
      body: JSON.stringify({ body: '# Note' }),
    });
    await upload([{ name: 'pic.png', bytes: PNG_3X2 }]);

    const images = await request('/api/resources?type=image');
    expect(await images.json()).toMatchObject({
      total: 1,
      items: [{ type: 'image' }],
    });
    const notes = await request('/api/resources?type=md');
    expect(await notes.json()).toMatchObject({
      total: 1,
      items: [{ type: 'md' }],
    });
    const all = await request('/api/resources');
    expect(await all.json()).toMatchObject({ total: 2 });
  });

  test('serves the file by id and refuses notes', async () => {
    await results(await upload([{ name: 'a.png', bytes: PNG_3X2 }]));
    await request('/api/resources/notes', {
      method: 'POST',
      body: JSON.stringify({ body: '# N' }),
    });

    const file = await request('/api/resources/1/file');
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect((await file.arrayBuffer()).byteLength).toBe(73);

    const note = await request('/api/resources/2/file');
    expect(note.status).toBe(404);
    expect(await note.json()).toEqual({
      code: 'not_found',
      message: 'Resource 2 has no file',
    });

    const missing = await request('/api/resources/99/file');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      code: 'not_found',
      message: 'Resource 99 not found',
    });

    const anonymous = await server.app.request('/api/resources/1/file');
    expect(anonymous.status).toBe(401);
  });

  test('patches title and notes on an image and refuses a body', async () => {
    await results(await upload([{ name: 'a.png', bytes: PNG_3X2 }]));

    const patched = await request('/api/resources/1', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Beach', notes: 'why' }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      id: 1,
      type: 'image',
      title: 'Beach',
      notes: 'why',
      width: 3,
    });

    const withBody = await request('/api/resources/1', {
      method: 'PATCH',
      body: JSON.stringify({ body: 'x' }),
    });
    expect(withBody.status).toBe(400);
    expect(await withBody.json()).toMatchObject({
      code: 'validation',
      errors: [{ path: 'body', message: 'Only notes have a body' }],
    });
  });

  test('deletes an image and removes its file', async () => {
    const rows = await results(await upload([{ name: 'a.png', bytes: PNG_3X2 }]));
    if (!rows[0]!.ok) throw new Error('upload failed');
    const full = path.join(server.dir, 'uploads', rows[0]!.resource.path);
    expect(fs.existsSync(full)).toBe(true);

    const deleted = await request('/api/resources', {
      method: 'DELETE',
      body: JSON.stringify({ ids: [1] }),
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({
      results: [{ id: 1, ok: true, unlinked_post_ids: [] }],
    });
    expect(fs.existsSync(full)).toBe(false);

    const get = await request('/api/resources/1');
    expect(get.status).toBe(404);
  });

  test('requires authentication', async () => {
    const form = new FormData();
    form.append('files', new File([PNG_3X2], 'a.png'));
    const response = await server.app.request('/api/resources/images', {
      method: 'POST',
      body: form,
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: 'unauthorized',
      message: 'Missing or invalid token',
    });
  });
});
