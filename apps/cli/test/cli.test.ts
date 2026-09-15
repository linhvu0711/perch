import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';

import { createTestServer, type TestServer } from '@perch/server/testing';

import { runCli } from '../src/cli';
import { AuthError, BatchFailure, CliError, UsageError } from '../src/output';
import { makeCtx } from './helpers';

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

afterEach(() => {
  server.cleanup();
});

describe('exit numbers', () => {
  test('error classes carry the exit number', () => {
    // Given/When
    const usage = new UsageError('bad_args', 'x');
    const auth = new AuthError('x');
    const plain = new CliError('not_found', 'x');
    const batch = new BatchFailure(1, 2);

    // Then
    expect(usage.exitCode).toBe(2);
    expect(auth.exitCode).toBe(3);
    expect(plain.exitCode).toBe(1);
    expect(batch.exitCode).toBe(1);
    expect(usage instanceof CliError).toBe(true);
    expect(auth instanceof CliError).toBe(true);
    expect(batch instanceof CliError).toBe(true);
    expect(auth.code).toBe('unauthorized');
    expect(batch.code).toBe('batch_failed');
    expect(batch.message).toBe('1 of 2 items failed');
  });

  test('exits 2 for usage, bad_args and bad_value before any request', async () => {
    // Given: a fetch that counts calls and forwards to the test server
    let requests = 0;
    const counting = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests += 1;
      return server.app.request(new Request(input, init));
    }) as typeof fetch;

    // When
    const week = makeCtx(server, { fetch: counting });
    const code1 = await runCli(['calendar', '--week', '--month', '--json'], week.ctx);
    const id = makeCtx(server, { fetch: counting });
    const code2 = await runCli(['post', 'show', 'abc', '--json'], id.ctx);
    const status = makeCtx(server, { fetch: counting });
    const code3 = await runCli(['post', 'list', '--status', 'nope', '--json'], status.ctx);
    const unknown = makeCtx(server, { fetch: counting });
    const code4 = await runCli(['nope', '--json'], unknown.ctx);

    // Then
    expect(code1).toBe(2);
    expect(code2).toBe(2);
    expect(code3).toBe(2);
    expect(code4).toBe(2);
    expect(JSON.parse(week.err())).toEqual({
      code: 'usage',
      message: 'Use one of --week or --month',
    });
    expect(JSON.parse(id.err())).toEqual({
      code: 'bad_args',
      message: 'id must be a positive integer',
    });
    expect(JSON.parse(status.err())).toEqual({
      code: 'bad_value',
      message: 'Unknown status: nope. Use draft, official, published, failed',
    });
    expect(JSON.parse(unknown.err()).code).toBe('usage');
    expect(requests).toBe(0);
    expect(week.out()).toBe('');
    expect(id.out()).toBe('');
    expect(status.out()).toBe('');
    expect(unknown.out()).toBe('');
  });

  test('exits 3 when the server answers unauthorized', async () => {
    // Given: a bad token
    const bad = makeCtx(server, { env: { PERCH_TOKEN: 'wrong' } });

    // When
    const code = await runCli(['post', 'list', '--json'], bad.ctx);

    // Then
    expect(code).toBe(3);
    expect(JSON.parse(bad.err())).toEqual({
      code: 'unauthorized',
      message: 'Missing or invalid token',
    });
    expect(bad.out()).toBe('');
  });

  test('exits 1 for every other failure', async () => {
    // Given: a server that cannot be reached, and a post that does not exist
    const down = makeCtx(server, {
      fetch: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    const missing = makeCtx(server);

    // When
    const downCode = await runCli(['post', 'list', '--json'], down.ctx);
    const missingCode = await runCli(['post', 'show', '999', '--json'], missing.ctx);

    // Then
    expect(downCode).toBe(1);
    expect(missingCode).toBe(1);
    expect(JSON.parse(down.err())).toEqual({
      code: 'unreachable',
      message: 'Cannot reach http://localhost:3000: ECONNREFUSED',
    });
    expect(JSON.parse(missing.err())).toEqual({
      code: 'not_found',
      message: 'Post 999 not found',
    });
  });

  test('prints errors as JSON or as an Error line by mode', async () => {
    // Given: three contexts, table and json modes
    const table = makeCtx(server, { isTTY: true });
    const json = makeCtx(server, { isTTY: true });
    const unknown = makeCtx(server, { isTTY: true });

    // When
    const tableCode = await runCli(['open', 'post', 'abc'], table.ctx);
    const jsonCode = await runCli(['open', 'post', 'abc', '--json'], json.ctx);
    const unknownCode = await runCli(['nope'], unknown.ctx);

    // Then
    expect(tableCode).toBe(2);
    expect(jsonCode).toBe(2);
    expect(unknownCode).toBe(2);
    expect(table.err()).toBe('Error: id must be a positive integer\n');
    expect(JSON.parse(json.err())).toEqual({
      code: 'bad_args',
      message: 'id must be a positive integer',
    });
    expect(unknown.err()).toContain("error: unknown command 'nope'");
    expect(table.out()).toBe('');
    expect(json.out()).toBe('');
    expect(unknown.out()).toBe('');
  });

  test('the entry file prints Error: and exits 2 on a bad env', () => {
    // Given: a real process with an invalid PERCH_SERVER_URL
    const result = Bun.spawnSync([process.execPath, 'src/index.ts', 'auth', 'status'], {
      cwd: path.join(import.meta.dir, '..'),
      env: { PERCH_SERVER_URL: 'notaurl' },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Then
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toBe('Error: PERCH_SERVER_URL must be a URL\n');
    expect(result.stdout.toString()).toBe('');
  });
});
