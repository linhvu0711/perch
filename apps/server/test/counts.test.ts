import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

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

describe('counts', () => {
  test('counts posts and resources', async () => {
    const counts = () => request('/api/counts');

    for (const n of ['# One', '# Two']) {
      const response = await request('/api/resources/notes', {
        method: 'POST',
        body: JSON.stringify({ body: n }),
      });
      expect(response.status).toBe(201);
    }
    for (let i = 0; i < 3; i += 1) {
      const response = await request('/api/posts', {
        method: 'POST',
        body: '{}',
      });
      expect(response.status).toBe(201);
    }

    expect(await (await counts()).json()).toEqual({ posts: 3, resources: 2 });

    const deleted = await request('/api/posts', {
      method: 'DELETE',
      body: JSON.stringify({ ids: [1] }),
    });
    expect(deleted.status).toBe(200);
    expect(await (await counts()).json()).toEqual({ posts: 2, resources: 2 });

    const unauthenticated = await server.app.request('/api/counts');
    expect(unauthenticated.status).toBe(401);
  });
});
