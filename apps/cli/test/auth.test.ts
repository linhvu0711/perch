import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';

import { createTestServer, type TestServer } from '@perch/server/testing';

import { runCli } from '../src/cli';
import { readConfig, writeConfig } from '../src/config';
import { makeCtx } from './helpers';

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

afterEach(() => {
  server.cleanup();
});

describe('auth commands', () => {
  test('reports valid auth as JSON', async () => {
    const capture = makeCtx(server);
    expect(await runCli(['auth', 'status', '--json'], capture.ctx)).toBe(0);
    expect(JSON.parse(capture.out())).toEqual({
      valid: true,
      user_id: 1,
      server_url: 'http://localhost:3000',
    });
    expect(capture.err()).toBe('');
  });

  test('reports valid auth as a table on a TTY', async () => {
    const capture = makeCtx(server, { isTTY: true });
    expect(await runCli(['auth', 'status'], capture.ctx)).toBe(0);
    const lines = capture.out().split('\n');
    expect(lines.some((line) => /^valid\s+true$/.test(line))).toBe(true);
  });

  test('maps invalid and missing tokens to distinct errors', async () => {
    const invalid = makeCtx(server, { env: { PERCH_TOKEN: 'wrong' } });
    expect(await runCli(['auth', 'status', '--json'], invalid.ctx)).toBe(3);
    expect(JSON.parse(invalid.err()).code).toBe('unauthorized');
    expect(invalid.out()).toBe('');

    const missing = makeCtx(server);
    delete missing.ctx.env.PERCH_TOKEN;
    expect(fs.existsSync(missing.ctx.configPath)).toBe(false);
    expect(await runCli(['auth', 'status', '--json'], missing.ctx)).toBe(1);
    expect(JSON.parse(missing.err()).code).toBe('no_token');
  });

  test('opens login only on a TTY', async () => {
    const tty = makeCtx(server, { isTTY: true });
    expect(await runCli(['auth', 'login'], tty.ctx)).toBe(0);
    expect(tty.opened).toEqual(['http://localhost:3000/']);
    expect(tty.out()).toContain('http://localhost:3000/');

    const piped = makeCtx(server);
    expect(await runCli(['auth', 'login', '--json'], piped.ctx)).toBe(0);
    expect(piped.opened).toEqual([]);
    expect(JSON.parse(piped.out()).url).toBe('http://localhost:3000/');
  });

  test('removes the token from the config file', async () => {
    const capture = makeCtx(server);
    writeConfig(capture.ctx.configPath, {
      token: 'stored',
      'server-url': 'http://example.test',
    });

    expect(await runCli(['auth', 'logout', '--json'], capture.ctx)).toBe(0);
    expect(readConfig(capture.ctx.configPath)).toEqual({
      'server-url': 'http://example.test',
    });
  });

  test('does not create a config file when logging out without one', async () => {
    const capture = makeCtx(server);
    expect(fs.existsSync(capture.ctx.configPath)).toBe(false);

    expect(await runCli(['auth', 'logout', '--json'], capture.ctx)).toBe(0);
    expect(fs.existsSync(capture.ctx.configPath)).toBe(false);
  });

  test('prints usage errors as JSON', async () => {
    const capture = makeCtx(server);
    expect(await runCli(['nope', '--json'], capture.ctx)).toBe(2);
    expect(JSON.parse(capture.err()).code).toBe('usage');
  });

  test('rejects a successful response whose body is not JSON', async () => {
    const capture = makeCtx(server);
    capture.ctx.fetch = ((_input, _init) =>
      Promise.resolve(
        new Response('<html></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      )) as typeof fetch;

    expect(await runCli(['auth', 'status', '--json'], capture.ctx)).toBe(1);
    expect(JSON.parse(capture.err()).code).toBe('bad_response');
  });
});
