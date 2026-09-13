import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { TestServer } from '@perch/server/testing';
import { createTestServer } from '@perch/server/testing';

import { runCli } from '../src/cli';
import { makeCtx } from './helpers';

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

afterEach(() => {
  server.cleanup();
});

describe('open', () => {
  test('opens post and resource URLs only on a TTY and rejects unknown ids', async () => {
    await server.app.request('/api/resources/notes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${server.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: '# Idea' }),
    });
    const setup = makeCtx(server);
    await runCli(['post', 'create', '--json'], setup.ctx);

    const tty = makeCtx(server, { isTTY: true });
    expect(await runCli(['open', 'post', '1'], tty.ctx)).toBe(0);
    expect(tty.opened).toEqual(['http://localhost:3000/posts/1']);
    expect(tty.out()).toContain('http://localhost:3000/posts/1');

    const json = makeCtx(server);
    expect(await runCli(['open', 'resource', '1', '--json'], json.ctx)).toBe(0);
    expect(json.opened).toEqual([]);
    expect(JSON.parse(json.out())).toEqual({
      url: 'http://localhost:3000/resources/1',
    });

    const missing = makeCtx(server);
    expect(await runCli(['open', 'post', '999', '--json'], missing.ctx)).toBe(1);
    expect(JSON.parse(missing.err()).code).toBe('not_found');
  });
});
