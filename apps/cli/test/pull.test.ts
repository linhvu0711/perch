import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import type { Resource } from '@perch/core';
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

let dir: string;
beforeEach(() => {
  dir = path.join(server.dir, 'mirror');
});

async function create(body: string, notes?: string): Promise<Resource> {
  const response = await server.app.request('/api/resources/notes', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${server.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body, ...(notes !== undefined ? { notes } : {}) }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Resource;
}

describe('resource pull', () => {
  test('writes one file per note into the mirror and a manifest', async () => {
    const { ctx, out } = makeCtx(server);
    await create('# Hello\n\ntext', 'why');
    await create('# Second');

    const code = await runCli(['resource', 'pull', '--dir', dir, '--json'], ctx);
    expect(code).toBe(0);
    expect(JSON.parse(out())).toEqual({
      dir,
      added: 2,
      updated: 0,
      removed: 0,
      pulled_at: '2026-09-04T10:00:00.000Z',
    });
    expect(
      fs.readFileSync(path.join(dir, 'notes/2026-09-04-1-hello.md'), 'utf8'),
    ).toBe(
      '---\nid: 1\ntype: "md"\ntitle: "Hello"\ncreated_at: "2026-09-04T10:00:00.000Z"\ntags: []\nnotes: |\n  why\n---\n# Hello\n\ntext\n',
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')),
    ).toEqual({
      pulled_at: '2026-09-04T10:00:00.000Z',
      paths: [
        'notes/2026-09-04-1-hello.md',
        'notes/2026-09-04-2-second.md',
      ],
    });
    expect(fs.readdirSync(dir).sort()).toEqual(['manifest.json', 'notes']);
  });

  test('rewrites only changed files, removes deleted ones, and keeps foreign files', async () => {
    const { ctx, out } = makeCtx(server);
    await create('# Hello');
    await create('# Second');
    await create('# Third');
    await runCli(['resource', 'pull', '--dir', dir, '--json'], ctx);

    const file1 = path.join(dir, 'notes/2026-09-04-1-hello.md');
    const file2 = path.join(dir, 'notes/2026-09-04-2-second.md');
    fs.writeFileSync(path.join(dir, 'notes/mine.md'), 'foreign');
    const mtime1 = fs.statSync(file1).mtimeMs;

    const patch = await server.app.request('/api/resources/2', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${server.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ notes: 'changed' }),
    });
    expect(patch.status).toBe(200);
    const del = await server.app.request('/api/resources', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${server.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: [3] }),
    });
    expect(del.status).toBe(200);

    const mark = out().length;
    const code = await runCli(['resource', 'pull', '--dir', dir, '--json'], ctx);
    expect(code).toBe(0);
    const second = JSON.parse(out().slice(mark));
    expect(second).toEqual({
      dir,
      added: 0,
      updated: 1,
      removed: 1,
      pulled_at: '2026-09-04T10:00:00.000Z',
    });
    expect(fs.statSync(file1).mtimeMs).toBe(mtime1);
    expect(fs.readFileSync(file2, 'utf8')).toContain('notes: |\n  changed\n');
    expect(fs.existsSync(path.join(dir, 'notes/2026-09-04-3-third.md'))).toBe(
      false,
    );
    expect(
      fs.readFileSync(path.join(dir, 'notes/mine.md'), 'utf8'),
    ).toBe('foreign');
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).paths,
    ).toEqual([
      'notes/2026-09-04-1-hello.md',
      'notes/2026-09-04-2-second.md',
    ]);
  });

  test('uses --dir, then the mirror-dir config key, then the default under home', async () => {
    const { ctx, out } = makeCtx(server);
    await create('# Hello');
    const dirA = path.join(server.dir, 'a');
    const dirB = path.join(server.dir, 'b');

    await runCli(['config', 'set', 'mirror-dir', dirB], ctx);
    expect(
      await runCli(['resource', 'pull', '--dir', dirA, '--json'], ctx),
    ).toBe(0);
    expect(await runCli(['resource', 'pull', '--json'], ctx)).toBe(0);
    const other = makeCtx(server, {
      configPath: path.join(server.dir, 'other-config.json'),
    });
    expect(await runCli(['resource', 'pull', '--json'], other.ctx)).toBe(0);

    expect(
      fs.existsSync(path.join(dirA, 'notes/2026-09-04-1-hello.md')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(dirB, 'notes/2026-09-04-1-hello.md')),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          server.dir,
          '.perch',
          'resources',
          'notes/2026-09-04-1-hello.md',
        ),
      ),
    ).toBe(true);
    const mark2 = out().length;
    await runCli(['resource', 'pull', '--json'], ctx);
    expect(JSON.parse(out().slice(mark2)).dir).toBe(dirB);
  });

  test('leaves the mirror untouched when the server is down or the token is bad', async () => {
    await create('# Hello');
    const down = makeCtx(server, {
      fetch: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    const bad = makeCtx(server, { env: { PERCH_TOKEN: 'wrong' } });

    expect(
      await runCli(['resource', 'pull', '--dir', dir], down.ctx),
    ).toBe(1);
    expect(JSON.parse(down.err())).toMatchObject({ code: 'unreachable' });
    expect(
      await runCli(['resource', 'pull', '--dir', dir], bad.ctx),
    ).toBe(3);
    expect(JSON.parse(bad.err())).toMatchObject({ code: 'unauthorized' });
    expect(fs.existsSync(dir)).toBe(false);
  });

  test('stops on a disk error and reports the written files', async () => {
    const { ctx, err } = makeCtx(server);
    await create('# Hello');
    await create('# Second');
    fs.mkdirSync(path.join(dir, 'notes/2026-09-04-2-second.md'), {
      recursive: true,
    });

    const code = await runCli(['resource', 'pull', '--dir', dir], ctx);
    expect(code).toBe(1);
    const error = JSON.parse(err());
    expect(error).toMatchObject({
      code: 'write_failed',
      errors: [{ path: 'notes/2026-09-04-1-hello.md', message: 'written' }],
    });
    expect(error.message).toMatch(/^Disk error at notes\/2026-09-04-2-second\.md: /);
    expect(
      fs.existsSync(path.join(dir, 'notes/2026-09-04-1-hello.md')),
    ).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')),
    ).toEqual({
      pulled_at: null,
      paths: [
        'notes/2026-09-04-1-hello.md',
        'notes/2026-09-04-2-second.md',
      ],
    });
  });

  test('prints a table summary on a TTY', async () => {
    const { ctx, out } = makeCtx(server, { isTTY: true });
    await create('# Hello');

    const code = await runCli(['resource', 'pull', '--dir', dir], ctx);
    expect(code).toBe(0);
    expect(out()).toMatch(/^added\s+1$/m);
    expect(out()).toMatch(/^removed\s+0$/m);
  });
});

describe('status', () => {
  test('prints the mirror path and last pull time in status', async () => {
    const { ctx, out } = makeCtx(server);
    await create('# Hello');
    await runCli(['config', 'set', 'mirror-dir', dir], ctx);

    const mark1 = out().length;
    await runCli(['status', '--json'], ctx);
    expect(JSON.parse(out().slice(mark1))).toEqual({
      mirror_dir: dir,
      last_pull_at: null,
    });

    await runCli(['resource', 'pull', '--json'], ctx);
    const mark = out().length;
    await runCli(['status', '--json'], ctx);
    expect(JSON.parse(out().slice(mark))).toEqual({
      mirror_dir: dir,
      last_pull_at: '2026-09-04T10:00:00.000Z',
    });

    const tty = makeCtx(server, { isTTY: true });
    await runCli(['status'], tty.ctx);
    expect(tty.out()).toMatch(/^mirror_dir\s+/m);
  });
});
