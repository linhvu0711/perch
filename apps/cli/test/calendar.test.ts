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

interface CalendarResult {
  from: string;
  to: string;
  days: Array<{ date: string; posts: Array<{ id: number; missed: boolean }> }>;
}

function dayIds(result: CalendarResult): Array<[string, number[]]> {
  return result.days.map((d) => [d.date, d.posts.map((p) => p.id)]);
}

/** Posts: 1 Launch (tag launch, Sep 10), 2 Note (Sep 12), 3 Old (Sep 2, past → missed). */
async function seedPosts(): Promise<void> {
  const setup = makeCtx(server);
  await runCli(['post', 'create', '--text', 'Launch', '--tag', 'launch', '--json'], setup.ctx);
  await runCli(['post', 'create', '--text', 'Note', '--json'], setup.ctx);
  await runCli(['post', 'create', '--text', 'Old', '--json'], setup.ctx);
  await runCli(['post', 'schedule', '1', '--at', '2026-09-10T09:00:00Z'], setup.ctx);
  await runCli(['post', 'schedule', '2', '--at', '2026-09-12T09:00:00Z'], setup.ctx);
  await runCli(
    ['post', 'schedule', '3', '--at', '2026-09-02T09:00:00Z', '--force'],
    setup.ctx,
  );
}

describe('perch calendar', () => {
  test('prints this month by day', async () => {
    // Given: the seeded posts
    await seedPosts();

    // When
    const run = makeCtx(server);
    const exit = await runCli(['calendar', '--json'], run.ctx);

    // Then
    expect(exit).toBe(0);
    const result = JSON.parse(run.out()) as CalendarResult;
    expect(result.from).toBe('2026-09-01');
    expect(result.to).toBe('2026-09-30');
    expect(dayIds(result)).toEqual([
      ['2026-09-02', [3]],
      ['2026-09-10', [1]],
      ['2026-09-12', [2]],
    ]);
    expect(result.days[0]?.posts[0]?.missed).toBe(true);
  });

  test('--week uses the Monday-first week of --from', async () => {
    // Given
    await seedPosts();

    // When
    const run = makeCtx(server);
    const exit = await runCli(
      ['calendar', '--week', '--from', '2026-09-10', '--json'],
      run.ctx,
    );

    // Then
    expect(exit).toBe(0);
    const result = JSON.parse(run.out()) as CalendarResult;
    expect(result.from).toBe('2026-09-07');
    expect(result.to).toBe('2026-09-13');
    expect(dayIds(result)).toEqual([
      ['2026-09-10', [1]],
      ['2026-09-12', [2]],
    ]);
  });

  test('--tag filters', async () => {
    // Given
    await seedPosts();

    // When
    const run = makeCtx(server);
    const exit = await runCli(['calendar', '--tag', 'launch', '--json'], run.ctx);

    // Then
    expect(exit).toBe(0);
    expect(dayIds(JSON.parse(run.out()) as CalendarResult)).toEqual([['2026-09-10', [1]]]);
  });

  test('prints an empty month', async () => {
    // Given
    await seedPosts();

    // When: JSON mode for October
    const json = makeCtx(server);
    const exit = await runCli(['calendar', '--from', '2026-10-01', '--json'], json.ctx);
    // Then
    expect(exit).toBe(0);
    expect((JSON.parse(json.out()) as CalendarResult).days).toEqual([]);

    // When: table mode for October
    const table = makeCtx(server, { isTTY: true });
    const tableExit = await runCli(['calendar', '--from', '2026-10-01'], table.ctx);
    // Then
    expect(tableExit).toBe(0);
    expect(table.out()).toBe('0 posts · 2026-10-01 – 2026-10-31\n');
  });

  test('prints a table with marks', async () => {
    // Given
    await seedPosts();
    const run = makeCtx(server, { isTTY: true });

    // When
    const exit = await runCli(['calendar'], run.ctx);

    // Then
    expect(exit).toBe(0);
    const out = run.out();
    expect(out).toContain('2026-09-02');
    expect(out).toContain('09:00');
    expect(out).toContain('MISSED');
    expect(out).toContain('Launch');
    expect(out).toContain('3 posts · 2026-09-01 – 2026-09-30');
    const header = out.split('\n')[0] ?? '';
    expect(header.startsWith('day')).toBe(true);
    expect(header).toContain('mark');
  });

  test('rejects --week with --month', async () => {
    // Given / When
    const run = makeCtx(server);
    const exit = await runCli(['calendar', '--week', '--month', '--json'], run.ctx);

    // Then
    expect(exit).toBe(2);
    expect(JSON.parse(run.err())).toEqual({
      code: 'usage',
      message: 'Use one of --week or --month',
    });
  });

  test('rejects a bad --from', async () => {
    // Given / When
    const run = makeCtx(server);
    const exit = await runCli(['calendar', '--from', '2026-9-1', '--json'], run.ctx);

    // Then
    expect(exit).toBe(2);
    expect(JSON.parse(run.err())).toEqual({
      code: 'usage',
      message: '--from must be YYYY-MM-DD',
    });
  });
});
