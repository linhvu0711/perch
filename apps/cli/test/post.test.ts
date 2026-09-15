import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { POST_LIST_LIMIT_DEFAULT } from '@perch/core';
import type { TestServer } from '@perch/server/testing';
import { connectTestAccount, createTestServer, PNG_3X2 } from '@perch/server/testing';

import { runCli } from '../src/cli';
import { makeCtx } from './helpers';

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

afterEach(() => {
  server.cleanup();
});

async function createNote(body: string): Promise<number> {
  const response = await server.app.request('/api/resources/notes', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${server.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: number }).id;
}

async function getPost(id: number): Promise<Response> {
  return server.app.request(`/api/posts/${id}`, {
    headers: { Authorization: `Bearer ${server.token}` },
  });
}

describe('post create', () => {
  test('creates a draft from --text, --file, stdin, and --from', async () => {
    const noteId = await createNote('# Idea');
    const filePath = path.join(server.dir, 'hello.txt');
    fs.writeFileSync(filePath, 'from file');

    const text = makeCtx(server);
    expect(await runCli(['post', 'create', '--text', 'Hello world', '--json'], text.ctx)).toBe(0);
    expect(JSON.parse(text.out())).toMatchObject({
      status: 'draft',
      text: 'Hello world',
      character_count: 11,
    });

    const file = makeCtx(server);
    expect(
      await runCli(
        ['post', 'create', '--file', filePath, '--from', String(noteId), '--json'],
        file.ctx,
      ),
    ).toBe(0);
    expect(JSON.parse(file.out())).toMatchObject({
      text: 'from file',
      links: [{ resource_id: noteId }],
    });

    const stdin = makeCtx(server, { stdin: 'from stdin' });
    expect(await runCli(['post', 'create', '-', '--json'], stdin.ctx)).toBe(0);
    expect(JSON.parse(stdin.out())).toMatchObject({ text: 'from stdin' });

    const both = makeCtx(server);
    expect(
      await runCli(['post', 'create', '--text', 'a', '--file', filePath, '--json'], both.ctx),
    ).toBe(2);
    expect(JSON.parse(both.err()).code).toBe('bad_args');

    const empty = makeCtx(server);
    expect(await runCli(['post', 'create', '--json'], empty.ctx)).toBe(0);
    expect(JSON.parse(empty.out())).toMatchObject({ text: '' });
  });
});

describe('post edit', () => {
  test('edits text from --text, --file, stdin, and the injected editor', async () => {
    const setup = makeCtx(server);
    await runCli(['post', 'create', '--text', 'old', '--json'], setup.ctx);

    const filePath = path.join(server.dir, 'new.txt');
    fs.writeFileSync(filePath, 'from file');

    const text = makeCtx(server);
    expect(
      await runCli(['post', 'edit', '1', '--text', 'new', '--title', 'T', '--json'], text.ctx),
    ).toBe(0);
    expect(JSON.parse(text.out())).toMatchObject({ text: 'new', title: 'T' });

    const file = makeCtx(server);
    expect(await runCli(['post', 'edit', '1', '--file', filePath, '--json'], file.ctx)).toBe(0);
    expect(JSON.parse(file.out())).toMatchObject({ text: 'from file' });

    const stdin = makeCtx(server, { stdin: 'from stdin' });
    expect(await runCli(['post', 'edit', '1', '-', '--json'], stdin.ctx)).toBe(0);
    expect(JSON.parse(stdin.out())).toMatchObject({ text: 'from stdin' });

    const editor = makeCtx(server, {
      isTTY: true,
      stdinIsTTY: true,
      editorResult: 'edited',
    });
    expect(await runCli(['post', 'edit', '1', '-e', '--json'], editor.ctx)).toBe(0);
    expect(JSON.parse(editor.out())).toMatchObject({ text: 'edited' });
    expect(editor.edits[0]).toBe('from stdin');

    const noTty = makeCtx(server);
    expect(await runCli(['post', 'edit', '1', '-e', '--json'], noTty.ctx)).toBe(1);
    expect(JSON.parse(noTty.err()).code).toBe('no_tty');

    const nothing = makeCtx(server);
    expect(await runCli(['post', 'edit', '1', '--json'], nothing.ctx)).toBe(2);
    expect(JSON.parse(nothing.err()).code).toBe('bad_args');
  });
});

describe('post list and show', () => {
  test('lists and shows posts in JSON and table modes', async () => {
    const one = makeCtx(server);
    await runCli(['post', 'create', '--text', 'banana split', '--json'], one.ctx);
    const two = makeCtx(server);
    await runCli(['post', 'create', '--title', 'Named', '--text', 'body', '--json'], two.ctx);

    const all = makeCtx(server);
    expect(await runCli(['post', 'list', '--json'], all.ctx)).toBe(0);
    const allResult = JSON.parse(all.out());
    expect(allResult.items.map((i: { id: number }) => i.id)).toEqual([2, 1]);
    expect(allResult.total).toBe(2);
    expect(allResult.next_cursor).toBeNull();

    const search = makeCtx(server);
    await runCli(['post', 'list', '--search', 'banana', '--json'], search.ctx);
    expect(JSON.parse(search.out()).items.map((i: { id: number }) => i.id)).toEqual([1]);

    const status = makeCtx(server);
    await runCli(['post', 'list', '--status', 'published', '--json'], status.ctx);
    expect(JSON.parse(status.out()).items).toEqual([]);

    const page1 = makeCtx(server);
    await runCli(['post', 'list', '--limit', '1', '--json'], page1.ctx);
    const first = JSON.parse(page1.out());
    expect(first.items.map((i: { id: number }) => i.id)).toEqual([2]);
    const page2 = makeCtx(server);
    await runCli(
      ['post', 'list', '--limit', '1', '--cursor', first.next_cursor, '--json'],
      page2.ctx,
    );
    expect(JSON.parse(page2.out()).items.map((i: { id: number }) => i.id)).toEqual([1]);

    const badStatus = makeCtx(server);
    expect(await runCli(['post', 'list', '--status', 'nope', '--json'], badStatus.ctx)).toBe(2);
    expect(JSON.parse(badStatus.err()).code).toBe('bad_value');

    const table = makeCtx(server, { isTTY: true });
    expect(await runCli(['post', 'list'], table.ctx)).toBe(0);
    expect(table.out()).toContain('banana split');
    expect(table.out()).toContain('2 shown · 2 total');

    const show = makeCtx(server, { isTTY: true });
    expect(await runCli(['post', 'show', '1'], show.ctx)).toBe(0);
    expect(show.out()).toContain('12 / 280');
    expect(show.out()).toContain('$0.015');
    expect(show.out()).toContain('banana split');

    const badId = makeCtx(server);
    expect(await runCli(['post', 'show', 'abc', '--json'], badId.ctx)).toBe(2);
    expect(JSON.parse(badId.err()).code).toBe('bad_args');
  });

  test('lists at most POST_LIST_LIMIT_DEFAULT posts by default', async () => {
    // Given: POST_LIST_LIMIT_DEFAULT + 1 posts
    for (let i = 0; i < POST_LIST_LIMIT_DEFAULT + 1; i++) {
      const ctx = makeCtx(server);
      await runCli(['post', 'create', '--text', `post ${i}`, '--json'], ctx.ctx);
    }

    // When: post list without --limit
    const list = makeCtx(server);
    await runCli(['post', 'list', '--json'], list.ctx);

    // Then: the page holds the core default, not a CLI copy
    const result = JSON.parse(list.out());
    expect(result.items).toHaveLength(POST_LIST_LIMIT_DEFAULT);
    expect(result.total).toBe(POST_LIST_LIMIT_DEFAULT + 1);
  });
});

describe('post preview', () => {
  test('previews as an ASCII card with character and Cost lines', async () => {
    const one = makeCtx(server);
    await runCli(['post', 'create', '--text', 'Hello world', '--json'], one.ctx);
    const two = makeCtx(server);
    await runCli(['post', 'create', '--text', '', '--json'], two.ctx);

    const card = makeCtx(server, { isTTY: true });
    expect(await runCli(['post', 'preview', '1'], card.ctx)).toBe(0);
    expect(card.out()).toBe(
      '+----------------------------------------------------------+\n' +
        '| Hello world                                              |\n' +
        '+----------------------------------------------------------+\n' +
        'Characters: 11 / 280\n' +
        'Cost: $0.015\n',
    );

    const json = makeCtx(server);
    expect(await runCli(['post', 'preview', '1', '--json'], json.ctx)).toBe(0);
    const preview = JSON.parse(json.out());
    expect(preview.segments).toEqual([{ kind: 'text', text: 'Hello world' }]);
    expect(preview.character_count).toBe(11);

    const empty = makeCtx(server, { isTTY: true });
    expect(await runCli(['post', 'preview', '2'], empty.ctx)).toBe(0);
    expect(empty.out()).toContain('| Nothing yet.');
    expect(empty.out()).toContain('Characters: 0 / 280');
  });
});

describe('post link and unlink', () => {
  test('links and unlinks with per-item results and exit codes', async () => {
    await createNote('# One');
    await createNote('# Two');
    const setup = makeCtx(server);
    await runCli(['post', 'create', '--json'], setup.ctx);

    const link = makeCtx(server);
    expect(await runCli(['post', 'link', '1', '--resource', '1', '999', '--json'], link.ctx)).toBe(
      1,
    );
    expect(JSON.parse(link.out())).toEqual([
      { id: 1, ok: true },
      {
        id: 999,
        ok: false,
        error: { code: 'not_found', message: 'Resource 999 not found' },
      },
    ]);
    expect(link.err()).toBe('');

    const link2 = makeCtx(server);
    expect(await runCli(['post', 'link', '1', '--resource', '2', '--json'], link2.ctx)).toBe(0);

    const unlink = makeCtx(server);
    expect(await runCli(['post', 'unlink', '1', '--resource', '1', '--json'], unlink.ctx)).toBe(0);

    const bad = makeCtx(server);
    expect(await runCli(['post', 'link', '1', '--resource', 'abc', '--json'], bad.ctx)).toBe(2);
    expect(JSON.parse(bad.err()).code).toBe('bad_args');
  });
});

describe('post attach and detach', () => {
  async function attachFixtures(): Promise<{ resourceId: number; png: string }> {
    const png = path.join(server.dir, 'pic.png');
    fs.writeFileSync(png, Buffer.from(PNG_3X2));
    const upload = makeCtx(server);
    expect(await runCli(['resource', 'add', 'image', png, '--json'], upload.ctx)).toBe(0);
    const resourceId = (
      JSON.parse(upload.out()) as Array<{ ok: boolean; resource: { id: number } }>
    )[0]!.resource.id;

    const setup = makeCtx(server);
    await runCli(['post', 'create', '--text', 'hi', '--json'], setup.ctx);
    return { resourceId, png };
  }

  test('attaches from resources and files with per-item results', async () => {
    const { resourceId, png } = await attachFixtures();

    const attach = makeCtx(server);
    expect(
      await runCli(['post', 'attach', '1', '--resource', String(resourceId), '--json'], attach.ctx),
    ).toBe(0);
    expect(JSON.parse(attach.out())).toEqual([
      {
        id: resourceId,
        ok: true,
        media: {
          id: 1,
          position: 1,
          mime: 'image/png',
          bytes: 73,
          from_resource_id: resourceId,
          present: true,
        },
      },
    ]);

    const attachFile = makeCtx(server);
    expect(await runCli(['post', 'attach', '1', '--file', png, '--json'], attachFile.ctx)).toBe(0);
    expect(JSON.parse(attachFile.out())).toEqual([
      {
        name: 'pic.png',
        ok: true,
        media: {
          id: 2,
          position: 2,
          mime: 'image/png',
          bytes: 73,
          from_resource_id: null,
          present: true,
        },
      },
    ]);

    const show = makeCtx(server, { isTTY: true });
    await runCli(['post', 'show', '1'], show.ctx);
    expect(show.out()).toContain('1, 2');
  });

  test('detaches by media position and all', async () => {
    const { resourceId, png } = await attachFixtures();
    const attach = makeCtx(server);
    await runCli(['post', 'attach', '1', '--resource', String(resourceId), '--json'], attach.ctx);
    const attachFile = makeCtx(server);
    await runCli(['post', 'attach', '1', '--file', png, '--json'], attachFile.ctx);

    const detach = makeCtx(server);
    expect(await runCli(['post', 'detach', '1', '--media', '1', '--json'], detach.ctx)).toBe(0);
    const detachedPost = JSON.parse(detach.out());
    expect(detachedPost.id).toBe(1);
    expect(detachedPost.media).toEqual([
      { id: 2, position: 1, mime: 'image/png', bytes: 73, from_resource_id: null, present: true },
    ]);

    const table = makeCtx(server, { isTTY: true });
    expect(await runCli(['post', 'detach', '1', '--all'], table.ctx)).toBe(0);
    expect(table.out()).toContain('2 / 280');
    expect(table.out().startsWith('[')).toBe(false);

    const reattach = makeCtx(server);
    expect(await runCli(['post', 'attach', '1', '--file', png, '--json'], reattach.ctx)).toBe(0);

    const detachAll = makeCtx(server);
    expect(await runCli(['post', 'detach', '1', '--all', '--json'], detachAll.ctx)).toBe(0);
    const emptiedPost = JSON.parse(detachAll.out());
    expect(emptiedPost.id).toBe(1);
    expect(emptiedPost.media).toEqual([]);
  });

  test('show prints a missing Media file in the ready column and present in json', async () => {
    const { resourceId } = await attachFixtures();
    const attach = makeCtx(server);
    expect(
      await runCli(['post', 'attach', '1', '--resource', String(resourceId), '--json'], attach.ctx),
    ).toBe(0);
    const dir = path.join(server.dir, 'uploads', '1', 'posts', '1');
    for (const file of fs.readdirSync(dir)) {
      fs.unlinkSync(path.join(dir, file));
    }

    const show = makeCtx(server, { isTTY: true });
    await runCli(['post', 'show', '1'], show.ctx);
    expect(show.out()).toContain('no Media 1 file is missing');

    const json = makeCtx(server);
    await runCli(['post', 'show', '1', '--json'], json.ctx);
    expect((JSON.parse(json.out()) as { media: unknown[] }).media).toEqual([
      {
        id: 1,
        position: 1,
        mime: 'image/png',
        bytes: 73,
        from_resource_id: resourceId,
        present: false,
      },
    ]);
  });

  test('reports a read_failed result for an unreadable file', async () => {
    const { png } = await attachFixtures();

    const attach = makeCtx(server);
    expect(
      await runCli(
        ['post', 'attach', '1', '--file', png, path.join(server.dir, 'missing.png'), '--json'],
        attach.ctx,
      ),
    ).toBe(1);
    const results = JSON.parse(attach.out()) as Array<{
      name: string;
      ok: boolean;
      media?: { position: number };
      error?: { code: string };
    }>;
    expect(results[0]?.name).toBe('missing.png');
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.error?.code).toBe('read_failed');
    expect(results[1]?.ok).toBe(true);
    expect(results[1]?.media?.position).toBe(1);
  });

  test('rejects bad attach and detach flags', async () => {
    await attachFixtures();

    const neither = makeCtx(server);
    expect(await runCli(['post', 'attach', '1', '--json'], neither.ctx)).toBe(2);
    expect(JSON.parse(neither.err()).code).toBe('bad_args');

    const detachNeither = makeCtx(server);
    expect(await runCli(['post', 'detach', '1', '--json'], detachNeither.ctx)).toBe(2);
    expect(JSON.parse(detachNeither.err())).toEqual({
      code: 'bad_args',
      message: 'Use one of --media or --all',
    });

    const detachBoth = makeCtx(server);
    expect(
      await runCli(['post', 'detach', '1', '--media', '1', '--all', '--json'], detachBoth.ctx),
    ).toBe(2);
    expect(JSON.parse(detachBoth.err()).code).toBe('bad_args');
  });
});

describe('post delete', () => {
  test('requires confirmation outside a TTY and deletes with --yes', async () => {
    const setup = makeCtx(server);
    await runCli(['post', 'create', '--json'], setup.ctx);
    await runCli(['post', 'create', '--json'], setup.ctx);

    const noTty = makeCtx(server);
    expect(await runCli(['post', 'delete', '1', '--json'], noTty.ctx)).toBe(1);
    expect(JSON.parse(noTty.err()).code).toBe('confirm_required');
    expect((await getPost(1)).status).toBe(200);

    const yes = makeCtx(server);
    expect(await runCli(['post', 'delete', '1', '999', '--yes', '--json'], yes.ctx)).toBe(1);
    expect(JSON.parse(yes.out())).toEqual([
      { id: 1, ok: true },
      {
        id: 999,
        ok: false,
        error: { code: 'not_found', message: 'Post 999 not found' },
      },
    ]);
    expect(yes.err()).toBe('');
    expect((await getPost(1)).status).toBe(404);

    const confirm = makeCtx(server, {
      isTTY: true,
      stdinIsTTY: true,
      confirmAnswer: true,
    });
    expect(await runCli(['post', 'delete', '2', '--json'], confirm.ctx)).toBe(0);
    expect(confirm.confirms[0]).toContain('2');

    const recreate = makeCtx(server);
    await runCli(['post', 'create', '--json'], recreate.ctx);
    const cancel = makeCtx(server, {
      isTTY: true,
      stdinIsTTY: true,
      confirmAnswer: false,
    });
    expect(await runCli(['post', 'delete', '3', '--json'], cancel.ctx)).toBe(0);
    expect(cancel.err()).toContain('Cancelled');
    expect((await getPost(3)).status).toBe(200);

    expect(server.xClient.calls).toEqual([]);
  });
});

describe('post tag', () => {
  test('tags and untags posts', async () => {
    for (const text of ['one', 'two']) {
      const c = makeCtx(server);
      await runCli(['post', 'create', '--text', text, '--json'], c.ctx);
    }

    const added = makeCtx(server);
    expect(await runCli(['post', 'tag', '1', '2', '--add', 'a', '--json'], added.ctx)).toBe(0);
    expect(JSON.parse(added.out())).toEqual([
      { id: 1, ok: true, tags: ['a'] },
      { id: 2, ok: true, tags: ['a'] },
    ]);

    const removed = makeCtx(server);
    expect(await runCli(['post', 'tag', '1', '--remove', 'a', '--json'], removed.ctx)).toBe(0);
    expect(JSON.parse(removed.out())).toEqual([{ id: 1, ok: true, tags: [] }]);

    const merged = makeCtx(server);
    expect(
      await runCli(['post', 'tag', '1', '99', '--add', 'b', '--remove', 'a', '--json'], merged.ctx),
    ).toBe(1);
    expect(JSON.parse(merged.out())).toEqual([
      { id: 1, ok: true, tags: ['b'] },
      { id: 99, ok: false, error: { code: 'not_found', message: 'Post 99 not found' } },
    ]);
  });

  test('creates a post with --tag', async () => {
    const capture = makeCtx(server);
    expect(
      await runCli(['post', 'create', '--text', 'hi', '--tag', 'a', 'b', '--json'], capture.ctx),
    ).toBe(0);
    expect(JSON.parse(capture.out()).tags).toEqual(['a', 'b']);
  });

  test('filters the list by --tag', async () => {
    const first = makeCtx(server);
    await runCli(['post', 'create', '--text', 'one', '--tag', 'a', '--json'], first.ctx);
    const second = makeCtx(server);
    await runCli(['post', 'create', '--text', 'two', '--json'], second.ctx);

    const capture = makeCtx(server);
    expect(await runCli(['post', 'list', '--tag', 'a', '--json'], capture.ctx)).toBe(0);
    expect(JSON.parse(capture.out()).items.map((i: { id: number }) => i.id)).toEqual([1]);
  });
});

describe('post status and schedule', () => {
  test('promotes and demotes with per-item results', async () => {
    const setup = makeCtx(server);
    await runCli(['post', 'create', '--text', 'Hello', '--json'], setup.ctx);
    await runCli(['post', 'create', '--json'], setup.ctx);

    const promote = makeCtx(server);
    expect(await runCli(['post', 'promote', '1', '2', '--json'], promote.ctx)).toBe(1);
    expect(JSON.parse(promote.out())).toEqual([
      { id: 1, ok: true },
      {
        id: 2,
        ok: false,
        error: {
          code: 'validation',
          message: 'Post 2 is not ready',
          errors: [{ path: 'text', message: 'Text is empty' }],
        },
      },
    ]);
    expect(promote.err()).toBe('');

    const demote = makeCtx(server);
    expect(await runCli(['post', 'demote', '1', '--json'], demote.ctx)).toBe(0);
    expect(JSON.parse(demote.out())).toEqual([{ id: 1, ok: true }]);
  });

  test('schedules with --at and --force', async () => {
    const setup = makeCtx(server);
    await runCli(['post', 'create', '--text', 'Hello', '--json'], setup.ctx);

    const future = makeCtx(server);
    expect(
      await runCli(['post', 'schedule', '1', '--at', '2026-09-10 09:00', '--json'], future.ctx),
    ).toBe(0);
    expect(JSON.parse(future.out()).scheduled_at).toBe('2026-09-10T09:00:00.000Z');

    const past = makeCtx(server);
    expect(
      await runCli(['post', 'schedule', '1', '--at', '2026-09-01 09:00', '--json'], past.ctx),
    ).toBe(1);
    expect(JSON.parse(past.err())).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'at', message: 'Time is in the past' }],
    });

    const forced = makeCtx(server);
    expect(
      await runCli(
        ['post', 'schedule', '1', '--at', '2026-09-01 09:00', '--force', '--json'],
        forced.ctx,
      ),
    ).toBe(0);
    expect(JSON.parse(forced.out()).scheduled_at).toBe('2026-09-01T09:00:00.000Z');
  });

  test('unschedules in a batch', async () => {
    const setup = makeCtx(server);
    await runCli(['post', 'create', '--text', 'Hello', '--json'], setup.ctx);
    await runCli(['post', 'schedule', '1', '--at', '2026-09-10 09:00', '--json'], setup.ctx);

    const unschedule = makeCtx(server);
    expect(await runCli(['post', 'unschedule', '1', '999', '--json'], unschedule.ctx)).toBe(1);
    expect(JSON.parse(unschedule.out())).toEqual([
      { id: 1, ok: true },
      { id: 999, ok: false, error: { code: 'not_found', message: 'Post 999 not found' } },
    ]);
  });

  test('lists scheduled and unscheduled', async () => {
    const setup = makeCtx(server);
    await runCli(['post', 'create', '--json'], setup.ctx);
    await runCli(['post', 'create', '--json'], setup.ctx);
    await runCli(['post', 'schedule', '1', '--at', '+2h', '--json'], setup.ctx);

    const scheduled = makeCtx(server);
    expect(await runCli(['post', 'list', '--scheduled', '--json'], scheduled.ctx)).toBe(0);
    expect(
      (JSON.parse(scheduled.out()) as { items: Array<{ id: number }> }).items.map((p) => p.id),
    ).toEqual([1]);

    const unscheduled = makeCtx(server);
    expect(await runCli(['post', 'list', '--unscheduled', '--json'], unscheduled.ctx)).toBe(0);
    expect(
      (JSON.parse(unscheduled.out()) as { items: Array<{ id: number }> }).items.map((p) => p.id),
    ).toEqual([2]);

    const both = makeCtx(server);
    expect(await runCli(['post', 'list', '--scheduled', '--unscheduled', '--json'], both.ctx)).toBe(
      2,
    );
    expect(JSON.parse(both.err())).toEqual({
      code: 'bad_args',
      message: 'Use one of --scheduled or --unscheduled',
    });
  });

  test('creates an official post', async () => {
    const ok = makeCtx(server);
    expect(
      await runCli(['post', 'create', '--text', 'Hello', '--official', '--json'], ok.ctx),
    ).toBe(0);
    expect(JSON.parse(ok.out()).status).toBe('official');

    const empty = makeCtx(server);
    expect(await runCli(['post', 'create', '--official', '--json'], empty.ctx)).toBe(1);
    expect(JSON.parse(empty.err())).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'text', message: 'Text is empty' }],
    });
  });
});

describe('post publish and retry', () => {
  test('publishes a draft and prints the post with the X url', async () => {
    connectTestAccount(server);
    const setup = makeCtx(server);
    await runCli(['post', 'create', '--text', 'Hello', '--json'], setup.ctx);

    const publish = makeCtx(server);
    expect(await runCli(['post', 'publish', '1', '--json'], publish.ctx)).toBe(0);
    expect(JSON.parse(publish.out())).toMatchObject({
      status: 'published',
      x_post_url: 'https://x.com/perchtester/status/2',
      scheduled_at: null,
    });
    expect(publish.err()).toBe('');
  });

  test('publish exits 1 with the promote checks on an empty draft', async () => {
    connectTestAccount(server);
    const setup = makeCtx(server);
    await runCli(['post', 'create', '--json'], setup.ctx);

    const publish = makeCtx(server);
    expect(await runCli(['post', 'publish', '1', '--json'], publish.ctx)).toBe(1);
    expect(JSON.parse(publish.err())).toEqual({
      code: 'validation',
      message: 'Invalid request',
      errors: [{ path: 'text', message: 'Text is empty' }],
    });
  });

  test('publish exits 1 with publish_failed and retry then succeeds', async () => {
    connectTestAccount(server);
    const setup = makeCtx(server);
    await runCli(['post', 'create', '--text', 'Hello', '--json'], setup.ctx);
    server.xClient.createPostError = new Error('Service Unavailable');

    const publish = makeCtx(server);
    expect(await runCli(['post', 'publish', '1', '--json'], publish.ctx)).toBe(1);
    expect(JSON.parse(publish.err())).toEqual({
      code: 'publish_failed',
      message: 'Service Unavailable',
    });

    server.xClient.createPostError = null;
    const retry = makeCtx(server);
    expect(await runCli(['post', 'retry', '1', '--json'], retry.ctx)).toBe(0);
    expect(JSON.parse(retry.out())).toMatchObject({
      status: 'published',
      retry_count: 1,
    });
  });

  test('post edit and delete print in_flight and exit 1 while the post is being sent', async () => {
    // Given: an official post and a send held on the X gate
    connectTestAccount(server);
    const setup = makeCtx(server);
    await runCli(['post', 'create', '--text', 'Hello', '--official', '--json'], setup.ctx);
    let release: () => void = () => {};
    server.xClient.createPostGate = new Promise((resolve) => {
      release = resolve;
    });

    // When: a publish holds the send while an edit and a delete arrive
    const pub = makeCtx(server);
    const first = runCli(['post', 'publish', '1', '--json'], pub.ctx);
    const editJson = makeCtx(server);
    const edit = await runCli(['post', 'edit', '1', '--text', 'Changed', '--json'], editJson.ctx);
    const editPlain = makeCtx(server, { isTTY: true });
    const plain = await runCli(['post', 'edit', '1', '--text', 'Changed'], editPlain.ctx);
    const del = makeCtx(server);
    const deleted = await runCli(['post', 'delete', '1', '--yes', '--json'], del.ctx);
    release();

    // Then: both refuse with the server message and exit 1, and the send lands
    expect(edit).toBe(1);
    expect(JSON.parse(editJson.err())).toEqual({
      code: 'in_flight',
      message: 'Post 1 is being sent',
    });
    expect(plain).toBe(1);
    expect(editPlain.err()).toContain('Error: Post 1 is being sent');
    expect(deleted).toBe(1);
    expect(JSON.parse(del.out())).toEqual([
      {
        id: 1,
        ok: false,
        error: { code: 'in_flight', message: 'Post 1 is being sent' },
      },
    ]);
    expect(del.err()).toBe('');
    expect(await first).toBe(0);
  });

  test('publish without an account exits 1', async () => {
    const setup = makeCtx(server);
    await runCli(['post', 'create', '--text', 'Hello', '--json'], setup.ctx);

    const publish = makeCtx(server);
    expect(await runCli(['post', 'publish', '1', '--json'], publish.ctx)).toBe(1);
    expect(JSON.parse(publish.err())).toEqual({
      code: 'not_found',
      message: 'No X account connected',
    });
  });

  test('lists missed posts and shows the flag in the table', async () => {
    const setup = makeCtx(server);
    await runCli(['post', 'create', '--text', 'Hello', '--json'], setup.ctx);
    await runCli(
      ['post', 'schedule', '1', '--at', '2026-09-01 09:00', '--force', '--json'],
      setup.ctx,
    );
    await runCli(['post', 'create', '--text', 'Later', '--json'], setup.ctx);
    await runCli(['post', 'schedule', '2', '--at', '2026-09-10 09:00', '--json'], setup.ctx);

    const json = makeCtx(server);
    expect(await runCli(['post', 'list', '--missed', '--json'], json.ctx)).toBe(0);
    const result = JSON.parse(json.out());
    expect(result.items.map((i: { id: number }) => i.id)).toEqual([1]);
    expect(result.items[0].missed).toBe(true);

    const table = makeCtx(server, { isTTY: true });
    expect(await runCli(['post', 'list', '--missed', '--table'], table.ctx)).toBe(0);
    const lines = table.out().split('\n');
    expect(lines.some((line) => line.includes('missed'))).toBe(true);
    expect(lines).toContain('1 shown · 1 total');
  });
});

describe('post list needs attention', () => {
  test('lists Issues with their reasons', async () => {
    // Given: a missed draft, a due-soon draft, and a later draft
    const setup = makeCtx(server);
    await runCli(['post', 'create', '--text', 'Old', '--json'], setup.ctx);
    await runCli(['post', 'schedule', '1', '--at', '2026-09-02T09:00:00Z', '--force'], setup.ctx);
    await runCli(['post', 'create', '--text', 'Soon', '--json'], setup.ctx);
    await runCli(['post', 'schedule', '2', '--at', '2026-09-06T09:00:00Z'], setup.ctx);
    await runCli(['post', 'create', '--text', 'Later', '--json'], setup.ctx);
    await runCli(['post', 'schedule', '3', '--at', '2026-09-12T09:00:00Z'], setup.ctx);

    // When
    const json = makeCtx(server);
    expect(await runCli(['post', 'list', '--needs-attention', '--json'], json.ctx)).toBe(0);
    const table = makeCtx(server, { isTTY: true });
    expect(await runCli(['post', 'list', '--needs-attention', '--table'], table.ctx)).toBe(0);

    // Then
    const result = JSON.parse(json.out());
    expect(result.items.map((item: { id: number }) => item.id)).toEqual([1]);
    expect(result.items.map((item: { reason: string }) => item.reason)).toEqual([
      'time passed, still a draft',
    ]);
    expect(result.total).toBe(1);
    expect(table.out()).toContain('time passed, still a draft');
    expect(table.out()).not.toContain('Soon');
  });
});
