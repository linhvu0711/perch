import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import { createTestServer, type TestServer } from '../src/testing';

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

afterEach(() => {
  server.cleanup();
});

describe('static app', () => {
  test('serves the SPA at root and client routes', async () => {
    const root = await server.app.request('/');
    expect(root.status).toBe(200);
    expect(root.headers.get('content-type')).toContain('text/html');
    expect(await root.text()).toContain('perch-test-app');

    const posts = await server.app.request('/posts');
    expect(posts.status).toBe(200);
    expect(await posts.text()).toContain('perch-test-app');
  });

  test('falls back safely for traversal and directories', async () => {
    fs.writeFileSync(path.join(server.dir, 'secret.txt'), 'SECRET');

    for (const requestPath of [
      '/..%2Fsecret.txt',
      '/assets/..%2F..%2Fsecret.txt',
    ]) {
      const response = await server.app.request(requestPath);
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(body).toContain('perch-test-app');
      expect(body).not.toContain('SECRET');
    }

    const traversal = await server.app.request('/assets/../index.html');
    expect(traversal.status).toBe(200);
    expect(await traversal.text()).toContain('perch-test-app');

    fs.mkdirSync(path.join(server.webDist, 'assets'), { recursive: true });
    const directory = await server.app.request('/assets/');
    expect(directory.status).toBe(200);
    expect(await directory.text()).toContain('perch-test-app');
  });

  test('serves assets with immutable caching', async () => {
    const assets = path.join(server.webDist, 'assets');
    fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(assets, 'app.js'), 'console.log("perch")');

    const response = await server.app.request('/assets/app.js');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(await response.text()).toBe('console.log("perch")');
  });

  test('does not let the SPA shadow API errors', async () => {
    const authenticated = await server.app.request('/api/nope', {
      headers: { Authorization: `Bearer ${server.token}` },
    });
    expect(authenticated.status).toBe(404);
    expect(await authenticated.json()).toMatchObject({ code: 'not_found' });

    const unauthenticated = await server.app.request('/api/nope');
    expect(unauthenticated.status).toBe(401);
  });

  test('returns JSON when the web app is not built', async () => {
    fs.rmSync(path.join(server.webDist, 'index.html'));
    const response = await server.app.request('/');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: 'internal',
      message: 'Web app is not built. Run `bun run build`.',
    });
  });
});
