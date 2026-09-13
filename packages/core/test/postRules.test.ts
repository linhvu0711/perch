import { describe, expect, test } from 'bun:test';

import {
  DEMOTE_FROM,
  nextAttemptAt,
  PROMOTE_FROM,
  PUBLISH_FROM,
  promoteChecks,
  readyChecks,
  RETRY_FROM,
  SCHEDULE_FROM,
} from '../src/postRules';

test('promoteChecks returns every failing check', () => {
  expect(
    promoteChecks({
      text: 'a'.repeat(281),
      limit: 280,
      media: [
        { position: 1, present: true },
        { position: 2, present: false },
      ],
    }),
  ).toEqual([
    { path: 'text', message: '281 of 280 characters' },
    { path: 'media', message: 'Media 2 file is missing' },
  ]);
  expect(promoteChecks({ text: '  ', limit: 280, media: [] })).toEqual([
    { path: 'text', message: 'Text is empty' },
  ]);
  expect(promoteChecks({ text: 'Hi', limit: 280, media: [] })).toEqual([]);
});

test('readyChecks labels', () => {
  expect(readyChecks({ text: '', limit: 25_000, mediaCount: 2, accountConnected: false })).toEqual({
    ok: false,
    checks: [
      { code: 'text', ok: false, label: 'Text is not empty' },
      { code: 'limit', ok: true, label: '0 of 25,000 characters' },
      { code: 'media', ok: true, label: '2 of 4 images' },
      { code: 'account', ok: false, label: 'No X account connected' },
    ],
  });
});

describe('status rules', () => {
  test('lists the statuses each transition accepts', () => {
    expect(PROMOTE_FROM).toEqual(['draft']);
    expect(DEMOTE_FROM).toEqual(['official', 'failed']);
    expect(SCHEDULE_FROM).toEqual(['draft', 'official']);
  });
});

test('nextAttemptAt walks +1, +5, +15 from the schedule time, then stops', () => {
  const scheduledAt = new Date('2026-09-04T10:30:00Z');
  expect(nextAttemptAt(scheduledAt, 1)?.toISOString()).toBe('2026-09-04T10:31:00.000Z');
  expect(nextAttemptAt(scheduledAt, 2)?.toISOString()).toBe('2026-09-04T10:35:00.000Z');
  expect(nextAttemptAt(scheduledAt, 3)?.toISOString()).toBe('2026-09-04T10:45:00.000Z');
  expect(nextAttemptAt(scheduledAt, 4)).toBeNull();
});

test('publish and retry status rules', () => {
  expect(PUBLISH_FROM).toEqual(['draft', 'official']);
  expect(RETRY_FROM).toEqual(['failed']);
});
