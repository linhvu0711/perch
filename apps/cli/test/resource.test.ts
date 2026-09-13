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

function write(name: string, body: string): string {
  const file = path.join(server.dir, name);
  fs.writeFileSync(file, body);
  return file;
}

async function create(body: string, title?: string): Promise<Resource> {
  const response = await server.app.request('/api/resources/notes', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${server.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body, ...(title !== undefined ? { title } : {}) }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Resource;
}

async function get(id: number): Promise<Response> {
  return server.app.request(`/api/resources/${id}`, {
    headers: { Authorization: `Bearer ${server.token}` },
  });
}

async function connect(): Promise<void> {
  const start = await server.app.request('/api/account/connect', {
    method: 'POST',
    headers: { Authorization: `Bearer ${server.token}` },
  });
  const { authorize_url } = (await start.json()) as { authorize_url: string };
  const state = new URL(authorize_url).searchParams.get('state');
  await server.app.request(`/auth/x/callback?code=abc&state=${state}`);
}

describe('resource add', () => {
  test('adds a Markdown file and persists it', async () => {
    const file = write('hello.md', '# Hello\n\nbody');
    const capture = makeCtx(server);
    expect(await runCli(['resource', 'add', 'md', file, '--json'], capture.ctx)).toBe(0);
    const results = JSON.parse(capture.out());
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      path: file,
      ok: true,
      resource: { title: 'Hello', body: '# Hello\n\nbody' },
    });
    expect(await (await get(results[0].resource.id)).json()).toEqual(results[0].resource);
  });

  test('reads stdin and falls back to Untitled', async () => {
    const capture = makeCtx(server, { stdin: 'no heading' });
    expect(await runCli(['resource', 'add', 'md', '-', '--json'], capture.ctx)).toBe(0);
    expect(JSON.parse(capture.out())[0].resource.title).toBe('Untitled');
  });

  test('uses the filename fallback and lets an explicit title win', async () => {
    const ideas = write('ideas.md', 'plain');
    const fallback = makeCtx(server);
    expect(await runCli(['resource', 'add', 'md', ideas, '--json'], fallback.ctx)).toBe(0);
    expect(JSON.parse(fallback.out())[0].resource.title).toBe('ideas');

    const explicit = makeCtx(server);
    expect(
      await runCli(
        ['resource', 'add', 'md', ideas, '--title', 'Given', '--json'],
        explicit.ctx,
      ),
    ).toBe(0);
    expect(JSON.parse(explicit.out())[0].resource.title).toBe('Given');
  });

  test('continues after a file read failure and exits one without stderr', async () => {
    const valid = write('valid.md', '# Valid');
    const missing = path.join(server.dir, 'missing.md');
    const capture = makeCtx(server);
    expect(
      await runCli(['resource', 'add', 'md', valid, missing, '--json'], capture.ctx),
    ).toBe(1);
    const results = JSON.parse(capture.out());
    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, error: { code: 'read_failed' } });
    expect(capture.err()).toBe('');
  });

  test('rejects stdin more than once before making requests', async () => {
    const capture = makeCtx(server, { stdin: '# One' });
    expect(
      await runCli(['resource', 'add', 'md', '-', '-', '--json'], capture.ctx),
    ).toBe(1);
    expect(JSON.parse(capture.err()).code).toBe('bad_args');
    const response = await server.app.request('/api/resources', {
      headers: { Authorization: `Bearer ${server.token}` },
    });
    expect(((await response.json()) as { total: number }).total).toBe(0);
  });
});

describe('resource list and show', () => {
  test('lists, sorts, searches, filters, and pages in JSON', async () => {
    const a = await create('# Alpha\nbanana');
    const b = await create('# Beta');
    const c = await create('# Gamma');

    const ascending = makeCtx(server);
    expect(await runCli(['resource', 'list', '--json'], ascending.ctx)).toBe(0);
    expect(JSON.parse(ascending.out())).toMatchObject({
      items: [{ id: a.id }, { id: b.id }, { id: c.id }],
      total: 3,
      next_cursor: null,
    });

    const descending = makeCtx(server);
    expect(await runCli(['resource', 'list', '--desc', '--json'], descending.ctx)).toBe(0);
    expect(JSON.parse(descending.out()).items.map((item: Resource) => item.id)).toEqual([
      c.id,
      b.id,
      a.id,
    ]);

    const search = makeCtx(server);
    expect(
      await runCli(['resource', 'list', '--search', 'banana', '--json'], search.ctx),
    ).toBe(0);
    expect(JSON.parse(search.out()).items.map((item: Resource) => item.id)).toEqual([a.id]);

    const first = makeCtx(server);
    expect(await runCli(['resource', 'list', '--limit', '1', '--json'], first.ctx)).toBe(0);
    const firstPage = JSON.parse(first.out());
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.next_cursor).not.toBeNull();
    const second = makeCtx(server);
    expect(
      await runCli(
        ['resource', 'list', '--limit', '1', '--cursor', firstPage.next_cursor, '--json'],
        second.ctx,
      ),
    ).toBe(0);
    expect(JSON.parse(second.out()).items[0].id).toBe(b.id);

    const tweets = makeCtx(server);
    expect(
      await runCli(['resource', 'list', '--type', 'tweet', '--json'], tweets.ctx),
    ).toBe(0);
    expect(JSON.parse(tweets.out())).toMatchObject({ items: [], total: 0 });
  });

  test('validates list options and prints table summaries', async () => {
    await create('# Alpha');
    await create('# Beta');
    await create('# Gamma');

    const type = makeCtx(server);
    expect(await runCli(['resource', 'list', '--type', 'nope', '--json'], type.ctx)).toBe(1);
    expect(JSON.parse(type.err()).code).toBe('bad_value');

    const sort = makeCtx(server);
    expect(await runCli(['resource', 'list', '--sort', 'nope', '--json'], sort.ctx)).toBe(1);
    expect(JSON.parse(sort.err()).code).toBe('bad_value');

    const table = makeCtx(server, { isTTY: true });
    expect(await runCli(['resource', 'list'], table.ctx)).toBe(0);
    expect(table.out()).toContain('Alpha');
    expect(table.out()).toContain('3 shown · 3 total');
  });

  test('shows a resource and validates ids', async () => {
    const resource = await create('# Show me');
    const shown = makeCtx(server);
    expect(
      await runCli(['resource', 'show', String(resource.id), '--json'], shown.ctx),
    ).toBe(0);
    expect(JSON.parse(shown.out())).toEqual(resource);

    const missing = makeCtx(server);
    expect(await runCli(['resource', 'show', '999', '--json'], missing.ctx)).toBe(1);
    expect(JSON.parse(missing.err()).code).toBe('not_found');

    const invalid = makeCtx(server);
    expect(await runCli(['resource', 'show', 'abc', '--json'], invalid.ctx)).toBe(1);
    expect(JSON.parse(invalid.err()).code).toBe('bad_args');
  });
});

describe('resource edit', () => {
  test('edits fields, file/stdin content, and injected editor content', async () => {
    const resource = await create('# Original');

    const fields = makeCtx(server);
    expect(
      await runCli(
        ['resource', 'edit', String(resource.id), '--title', 'T', '--notes', 'N', '--json'],
        fields.ctx,
      ),
    ).toBe(0);
    expect(JSON.parse(fields.out())).toMatchObject({ title: 'T', notes: 'N' });

    const contentFile = write('replacement.md', 'from file');
    const fileEdit = makeCtx(server);
    expect(
      await runCli(
        ['resource', 'edit', String(resource.id), '--content', contentFile, '--json'],
        fileEdit.ctx,
      ),
    ).toBe(0);
    expect(JSON.parse(fileEdit.out()).body).toBe('from file');

    const stdinEdit = makeCtx(server, { stdin: 'from stdin' });
    expect(
      await runCli(
        ['resource', 'edit', String(resource.id), '--content', '-', '--json'],
        stdinEdit.ctx,
      ),
    ).toBe(0);
    expect(JSON.parse(stdinEdit.out()).body).toBe('from stdin');

    const editor = makeCtx(server, {
      isTTY: true,
      stdinIsTTY: true,
      editorResult: 'edited',
    });
    expect(
      await runCli(['resource', 'edit', String(resource.id), '-e', '--json'], editor.ctx),
    ).toBe(0);
    expect(JSON.parse(editor.out()).body).toBe('edited');
    expect(editor.edits[0]).toBe('from stdin');
  });

  test('validates editor and update arguments', async () => {
    const resource = await create('# Original');

    const noTty = makeCtx(server, { isTTY: false });
    expect(
      await runCli(['resource', 'edit', String(resource.id), '-e', '--json'], noTty.ctx),
    ).toBe(1);
    expect(JSON.parse(noTty.err()).code).toBe('no_tty');

    const noFlags = makeCtx(server);
    expect(
      await runCli(['resource', 'edit', String(resource.id), '--json'], noFlags.ctx),
    ).toBe(1);
    expect(JSON.parse(noFlags.err()).code).toBe('bad_args');

    const both = makeCtx(server);
    expect(
      await runCli(
        ['resource', 'edit', String(resource.id), '--content', 'f', '-e', '--json'],
        both.ctx,
      ),
    ).toBe(1);
    expect(JSON.parse(both.err()).code).toBe('bad_args');
  });
});

describe('resource delete', () => {
  test('requires confirmation outside a TTY and reports mixed batches', async () => {
    const resource = await create('# Delete me');
    const refused = makeCtx(server);
    expect(
      await runCli(['resource', 'delete', String(resource.id), '--json'], refused.ctx),
    ).toBe(1);
    expect(JSON.parse(refused.err()).code).toBe('confirm_required');
    expect((await get(resource.id)).status).toBe(200);

    const mixed = makeCtx(server);
    expect(
      await runCli(
        ['resource', 'delete', String(resource.id), '999', '--yes', '--json'],
        mixed.ctx,
      ),
    ).toBe(1);
    const results = JSON.parse(mixed.out());
    expect(results[0].ok).toBe(true);
    expect(results[1].error.code).toBe('not_found');
    expect(mixed.err()).toBe('');
    expect((await get(resource.id)).status).toBe(404);

    const second = await create('# Second');
    const success = makeCtx(server);
    expect(
      await runCli(
        ['resource', 'delete', String(second.id), '--yes', '--json'],
        success.ctx,
      ),
    ).toBe(0);
  });

  test('accepts or cancels a TTY confirmation', async () => {
    const acceptedResource = await create('# Accepted');
    const accepted = makeCtx(server, {
      isTTY: true,
      stdinIsTTY: true,
      confirmAnswer: true,
    });
    expect(
      await runCli(['resource', 'delete', String(acceptedResource.id), '--json'], accepted.ctx),
    ).toBe(0);
    expect(accepted.confirms[0]).toContain(String(acceptedResource.id));
    expect((await get(acceptedResource.id)).status).toBe(404);

    const kept = await create('# Kept');
    const cancelled = makeCtx(server, {
      isTTY: true,
      stdinIsTTY: true,
      confirmAnswer: false,
    });
    expect(
      await runCli(['resource', 'delete', String(kept.id), '--json'], cancelled.ctx),
    ).toBe(0);
    expect(cancelled.out()).toBe('');
    expect(cancelled.err()).toContain('Cancelled');
    expect((await get(kept.id)).status).toBe(200);
  });

  test('rejects invalid ids before a request', async () => {
    const capture = makeCtx(server);
    expect(await runCli(['resource', 'delete', 'abc', '--yes', '--json'], capture.ctx)).toBe(1);
    expect(JSON.parse(capture.err()).code).toBe('bad_args');
  });
});

describe('resource add image', () => {
  function writeBytes(name: string, bytes: Uint8Array): string {
    const file = path.join(server.dir, name);
    fs.writeFileSync(file, bytes);
    return file;
  }

  test('uploads image files and persists them', async () => {
    const { PNG_3X2, GIF_4X3 } = await import('@perch/server/testing');
    const a = writeBytes('a.png', PNG_3X2);
    const d = writeBytes('d.gif', GIF_4X3);
    const capture = makeCtx(server);

    expect(
      await runCli(['resource', 'add', 'image', a, d, '--json'], capture.ctx),
    ).toBe(0);
    const rows = JSON.parse(capture.out());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      path: a,
      ok: true,
      resource: {
        id: 1,
        type: 'image',
        title: 'a.png',
        mime: 'image/png',
        bytes: 73,
        width: 3,
        height: 2,
      },
    });
    expect(rows[1]).toMatchObject({
      ok: true,
      resource: { id: 2, title: 'd.gif', mime: 'image/gif', width: 4, height: 3 },
    });

    const response = await server.app.request('/api/resources/1', {
      headers: { Authorization: `Bearer ${server.token}` },
    });
    expect(await response.json()).toEqual(rows[0].resource);
  });

  test('reports a wrong-type file and continues', async () => {
    const { PNG_3X2 } = await import('@perch/server/testing');
    const notesTxt = write('notes.txt', 'hello');
    const okPng = writeBytes('ok.png', PNG_3X2);
    const capture = makeCtx(server);

    expect(
      await runCli(
        ['resource', 'add', 'image', notesTxt, okPng, '--json'],
        capture.ctx,
      ),
    ).toBe(1);
    expect(capture.err()).toBe('');
    const rows = JSON.parse(capture.out());
    expect(rows[0]).toEqual({
      path: notesTxt,
      ok: false,
      error: { code: 'bad_type', message: 'Only PNG, JPG, WebP, or GIF' },
    });
    expect(rows[1]).toMatchObject({ ok: true, resource: { id: 1 } });
  });

  test('lets an explicit title win for one file and rejects it for many', async () => {
    const { PNG_3X2 } = await import('@perch/server/testing');
    const a = writeBytes('a.png', PNG_3X2);
    const b = writeBytes('b.png', PNG_3X2);

    const single = makeCtx(server);
    expect(
      await runCli(
        ['resource', 'add', 'image', a, '--title', 'Beach', '--json'],
        single.ctx,
      ),
    ).toBe(0);
    expect(JSON.parse(single.out())[0].resource.title).toBe('Beach');

    const many = makeCtx(server);
    expect(
      await runCli(
        ['resource', 'add', 'image', a, b, '--title', 'X', '--json'],
        many.ctx,
      ),
    ).toBe(1);
    expect(JSON.parse(many.err())).toMatchObject({
      code: 'bad_args',
      message: '--title needs exactly one path',
    });

    const stdin = makeCtx(server);
    expect(
      await runCli(['resource', 'add', 'image', '-', '--json'], stdin.ctx),
    ).toBe(1);
    expect(JSON.parse(stdin.err())).toMatchObject({
      code: 'bad_args',
      message: 'stdin (-) is not supported for images',
    });
  });

  test('shows an image resource', async () => {
    const { PNG_3X2 } = await import('@perch/server/testing');
    const a = writeBytes('a.png', PNG_3X2);
    await runCli(['resource', 'add', 'image', a, '--json'], makeCtx(server).ctx);

    const capture = makeCtx(server);
    expect(await runCli(['resource', 'show', '1', '--json'], capture.ctx)).toBe(0);
    const shown = JSON.parse(capture.out());
    expect(shown).toMatchObject({
      id: 1,
      type: 'image',
      mime: 'image/png',
      width: 3,
      height: 2,
    });
    expect(shown).not.toHaveProperty('body');
  });

  test('adds tweets from URLs and reports per-item results', async () => {
    // Given: a connected account and one tweet that carries media
    await connect();
    server.xClient.tweets['2'] = { ...server.xClient.tweet, id: '2', hasMedia: true };

    // When
    const capture = makeCtx(server);
    const code = await runCli(
      [
        'resource',
        'add',
        'tweet',
        'https://x.com/perchtester/status/1',
        'https://x.com/perchtester/status/2',
        '--json',
      ],
      capture.ctx,
    );

    // Then
    expect(code).toBe(1);
    expect(capture.err()).toBe('');
    expect(JSON.parse(capture.out())).toMatchObject([
      {
        url: 'https://x.com/perchtester/status/1',
        ok: true,
        status: 'created',
        resource: { id: 1, author_username: 'perchtester', text: 'hello' },
      },
      {
        url: 'https://x.com/perchtester/status/2',
        ok: false,
        error: { code: 'has_media', message: 'Post has media' },
      },
    ]);

    const shown = makeCtx(server, { isTTY: true });
    expect(await runCli(['resource', 'show', '1'], shown.ctx)).toBe(0);
    expect(shown.out()).toContain('@perchtester');
    expect(shown.out()).toContain('hello');
  });

  test('refreshes a saved tweet and refuses without an X account', async () => {
    // Given: no account for the first call, then one saved tweet with edited text
    const denied = makeCtx(server);
    expect(
      await runCli(
        ['resource', 'add', 'tweet', 'https://x.com/perchtester/status/1', '--json'],
        denied.ctx,
      ),
    ).toBe(1);
    expect(JSON.parse(denied.err()).code).toBe('not_found');

    await connect();
    await server.app.request('/api/resources/tweets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${server.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ urls: ['https://x.com/perchtester/status/1'] }),
    });
    server.xClient.tweet.text = 'hello edited';

    // When/Then
    const existing = makeCtx(server);
    expect(
      await runCli(
        ['resource', 'add', 'tweet', 'https://x.com/perchtester/status/1', '--json'],
        existing.ctx,
      ),
    ).toBe(0);
    expect(JSON.parse(existing.out())[0]).toMatchObject({ status: 'existing' });

    const refreshed = makeCtx(server);
    expect(
      await runCli(
        [
          'resource',
          'add',
          'tweet',
          'https://x.com/perchtester/status/1',
          '--refresh',
          '--json',
        ],
        refreshed.ctx,
      ),
    ).toBe(0);
    expect(JSON.parse(refreshed.out())[0]).toMatchObject({
      status: 'refreshed',
      resource: { text: 'hello edited' },
    });
  });

  test('filters the list by author and date saved', async () => {
    // Given: one tweet and one note, both saved today
    await connect();
    await server.app.request('/api/resources/tweets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${server.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ urls: ['https://x.com/perchtester/status/1'] }),
    });
    await create('# Note');

    // When/Then
    const byAuthor = makeCtx(server);
    expect(
      await runCli(
        ['resource', 'list', '--author', '@perchtester', '--json'],
        byAuthor.ctx,
      ),
    ).toBe(0);
    expect(
      JSON.parse(byAuthor.out()).items.map((item: Resource) => item.id),
    ).toEqual([1]);

    const byDate = makeCtx(server);
    expect(
      await runCli(
        ['resource', 'list', '--from', '2026-09-04', '--to', '2026-09-04', '--json'],
        byDate.ctx,
      ),
    ).toBe(0);
    expect(JSON.parse(byDate.out()).total).toBe(2);

    const badDate = makeCtx(server);
    expect(
      await runCli(['resource', 'list', '--from', 'yesterday', '--json'], badDate.ctx),
    ).toBe(1);
    expect(JSON.parse(badDate.err()).code).toBe('bad_value');
  });
});
