import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Resource } from '@perch/core';

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

async function create(input: Record<string, unknown>): Promise<Resource> {
  const response = await request('/api/resources/notes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Resource;
}

async function upload(
  files: { name: string; bytes: Uint8Array; type?: string }[],
): Promise<Response> {
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

describe('GET /api/resources/export', () => {
  test('exports every resource as JSON lines', async () => {
    await create({ body: '# One', notes: 'n1', title: 'One' });
    await create({ body: '# Two' });
    await upload([{ name: 'a.png', bytes: PNG_3X2, type: 'image/png' }]);

    const response = await request('/api/resources/export');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/x-ndjson');
    const text = await response.text();
    const lines = text.split('\n');
    expect(lines.length).toBe(4);
    expect(lines[3]).toBe('');
    expect(JSON.parse(lines[0]!)).toEqual({
      id: 1,
      type: 'md',
      title: 'One',
      notes: 'n1',
      created_at: '2026-09-04T10:00:00.000Z',
      body: '# One',
      tags: [],
    });
    const third = await request('/api/resources/3');
    expect(JSON.parse(lines[2]!)).toEqual(await third.json());

    server.cleanup();
    server = await createTestServer();
    const empty = await request('/api/resources/export');
    expect(empty.status).toBe(200);
    expect(await empty.text()).toBe('');
  });

  test('requires authentication', async () => {
    const response = await server.app.request('/api/resources/export');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: 'unauthorized',
      message: 'Missing or invalid token',
    });
  });
});
