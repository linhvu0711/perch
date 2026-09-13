import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createTestServer, type TestServer } from '../src/testing';

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

afterEach(() => {
  server.cleanup();
});

describe('health', () => {
  test('answers 200 without a session', async () => {
    // Given: a test server, no Authorization header
    // When: GET /health
    const response = await server.app.request('/health');
    // Then: 200 { ok: true }
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test('is not under /api', async () => {
    // Given: a test server, no Authorization header
    // When: GET /api/health
    const response = await server.app.request('/api/health');
    // Then: the /api middleware still guards it
    expect(response.status).toBe(401);
  });
});
