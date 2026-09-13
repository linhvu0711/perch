import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { Resource, TagList } from '@perch/core';
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

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${server.token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  return server.app.request(path, { ...init, headers });
}

async function createNote(body: string, tags?: string[]): Promise<Resource> {
  const response = await request('/api/resources/notes', {
    method: 'POST',
    body: JSON.stringify({ body, ...(tags !== undefined ? { tags } : {}) }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Resource;
}

describe('tag', () => {
  test('lists tags with counts', async () => {
    await createNote('# One', ['a']);

    const json = makeCtx(server);
    expect(await runCli(['tag', 'list', '--json'], json.ctx)).toBe(0);
    const parsed = JSON.parse(json.out()) as TagList;
    expect(parsed.items[0]).toMatchObject({ name: 'a', resource_count: 1, post_count: 0 });

    const table = makeCtx(server, { isTTY: true });
    expect(await runCli(['tag', 'list'], table.ctx)).toBe(0);
    expect(table.out()).toContain('a');
    expect(table.out()).toContain('1 shown · 1 total');
  });

  test('creates tags in a batch', async () => {
    const capture = makeCtx(server);
    expect(await runCli(['tag', 'create', 'a', 'A', 'b', '--json'], capture.ctx)).toBe(1);
    expect(JSON.parse(capture.out())).toEqual([
      { name: 'a', ok: true, tag: { id: 1, name: 'a', resource_count: 0, post_count: 0 } },
      { name: 'A', ok: false, error: { code: 'validation', message: 'Invalid request' } },
      { name: 'b', ok: true, tag: { id: 2, name: 'b', resource_count: 0, post_count: 0 } },
    ]);
  });

  test('renames a tag', async () => {
    await createNote('# One', ['old']);

    const capture = makeCtx(server);
    expect(await runCli(['tag', 'rename', 'OLD', 'new', '--json'], capture.ctx)).toBe(0);
    expect(JSON.parse(capture.out())).toMatchObject({ id: 1, name: 'new' });
    const resource = (await (await request('/api/resources/1')).json()) as Resource;
    expect(resource.tags).toEqual(['new']);

    const ghost = makeCtx(server);
    expect(await runCli(['tag', 'rename', 'ghost', 'x', '--json'], ghost.ctx)).toBe(1);
    expect(JSON.parse(ghost.err())).toMatchObject({
      code: 'not_found',
      message: 'Tag "ghost" not found',
    });
  });

  test('deletes tags after confirmation', async () => {
    await createNote('# One', ['a', 'b']);

    const capture = makeCtx(server, { isTTY: true, stdinIsTTY: true, confirmAnswer: true });
    expect(await runCli(['tag', 'delete', 'a', 'ghost', '--json'], capture.ctx)).toBe(1);
    expect(capture.confirms).toEqual(['Delete 2 tags (a, ghost)?']);
    expect(JSON.parse(capture.out())).toEqual([
      { name: 'a', ok: true },
      { name: 'ghost', ok: false, error: { code: 'not_found', message: 'Tag "ghost" not found' } },
    ]);

    const resource = (await (await request('/api/resources/1')).json()) as Resource;
    expect(resource.tags).toEqual(['b']);
  });

  test('refuses to delete without --yes', async () => {
    await createNote('# One', ['a']);

    const capture = makeCtx(server);
    expect(await runCli(['tag', 'delete', 'a', '--json'], capture.ctx)).toBe(1);
    expect(JSON.parse(capture.err())).toMatchObject({
      code: 'confirm_required',
      message: 'Refusing to delete without --yes',
    });

    const confirmed = makeCtx(server);
    expect(await runCli(['tag', 'delete', 'a', '--yes', '--json'], confirmed.ctx)).toBe(0);
  });
});
