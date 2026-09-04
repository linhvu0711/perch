import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';

import { createTestServer, type TestServer } from '@perch/server/testing';

import { runCli } from '../src/cli';
import { makeCtx } from './helpers';

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

afterEach(() => {
  server.cleanup();
});

describe('config commands', () => {
  test('sets and gets local values without applying URL normalization', async () => {
    const set = makeCtx(server);
    expect(
      await runCli(
        ['config', 'set', 'server-url', 'http://example.test/', '--json'],
        set.ctx,
      ),
    ).toBe(0);
    expect(JSON.parse(fs.readFileSync(set.ctx.configPath, 'utf8'))).toEqual({
      'server-url': 'http://example.test/',
    });

    const get = makeCtx(server, { configPath: set.ctx.configPath });
    expect(await runCli(['config', 'get', 'server-url', '--json'], get.ctx)).toBe(0);
    expect(JSON.parse(get.out())).toEqual({
      key: 'server-url',
      value: 'http://example.test/',
    });
  });

  test('sets and gets remote settings', async () => {
    const timezone = makeCtx(server);
    expect(
      await runCli(
        ['config', 'set', 'timezone', 'Europe/Berlin', '--json'],
        timezone.ctx,
      ),
    ).toBe(0);

    const response = await server.app.request('/api/settings', {
      headers: { Authorization: `Bearer ${server.token}` },
    });
    expect(await response.json()).toMatchObject({ timezone: 'Europe/Berlin' });

    const getTimezone = makeCtx(server, { isTTY: true });
    expect(await runCli(['config', 'get', 'timezone'], getTimezone.ctx)).toBe(0);
    expect(getTimezone.out()).toContain('Europe/Berlin');

    const limit = makeCtx(server);
    expect(
      await runCli(['config', 'set', 'char-limit', '280', '--json'], limit.ctx),
    ).toBe(0);
    const getLimit = makeCtx(server);
    expect(
      await runCli(['config', 'get', 'char-limit', '--json'], getLimit.ctx),
    ).toBe(0);
    expect(JSON.parse(getLimit.out()).value).toBe(280);

    const clear = makeCtx(server);
    expect(
      await runCli(['config', 'set', 'char-limit', 'none', '--json'], clear.ctx),
    ).toBe(0);
    expect(JSON.parse(clear.out()).value).toBeNull();
  });

  test('rejects invalid values and keys', async () => {
    const badValue = makeCtx(server);
    expect(
      await runCli(['config', 'set', 'char-limit', 'abc', '--json'], badValue.ctx),
    ).toBe(1);
    expect(JSON.parse(badValue.err()).code).toBe('bad_value');

    const badKey = makeCtx(server);
    expect(await runCli(['config', 'get', 'nope', '--json'], badKey.ctx)).toBe(1);
    expect(JSON.parse(badKey.err()).code).toBe('bad_key');
  });

  test('uses the global server URL override for requests', async () => {
    const urls: string[] = [];
    const capture = makeCtx(server);
    capture.ctx.fetch = ((input, init) => {
      urls.push(input instanceof Request ? input.url : String(input));
      return server.app.request(new Request(input, init));
    }) as typeof fetch;

    expect(
      await runCli(
        ['--server', 'http://other.test', 'config', 'get', 'timezone', '--json'],
        capture.ctx,
      ),
    ).toBe(0);
    expect(urls[0]).toStartWith('http://other.test/api/');
  });
});
