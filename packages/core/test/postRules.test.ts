import { describe, expect, test } from 'bun:test';

import {
  DEMOTE_FROM,
  nextAttemptAt,
  PROMOTE_FROM,
  PUBLISH_FROM,
  promoteChecks,
  RETRY_FROM,
  readyChecks,
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
  const media = [
    { position: 1, present: true },
    { position: 2, present: true },
  ];
  expect(readyChecks({ text: '', limit: 25_000, media, accountConnected: false })).toEqual({
    ok: false,
    checks: [
      { code: 'text', ok: false, label: 'Text is not empty' },
      { code: 'limit', ok: true, label: '0 of 25,000 characters' },
      { code: 'media', ok: true, label: '2 of 4 images' },
      { code: 'account', ok: false, label: 'No X account connected' },
    ],
  });
});

test('readyChecks lists a missing media file and fails', () => {
  const input = {
    text: 'Hi',
    limit: 280,
    media: [
      { position: 1, present: true },
      { position: 2, present: false },
    ],
    accountConnected: true,
  };
  expect(readyChecks(input)).toEqual({
    ok: false,
    checks: [
      { code: 'text', ok: true, label: 'Text is not empty' },
      { code: 'limit', ok: true, label: '2 of 280 characters' },
      { code: 'media', ok: false, label: 'Media 2 file is missing' },
      { code: 'account', ok: true, label: 'X account connected' },
    ],
  });
});

test('readyChecks names every missing media file in one row', () => {
  const input = {
    text: 'Hi',
    limit: 280,
    media: [
      { position: 1, present: false },
      { position: 2, present: true },
      { position: 3, present: false },
    ],
    accountConnected: true,
  };
  const ready = readyChecks(input);
  expect(ready.ok).toBe(false);
  expect(ready.checks).toHaveLength(4);
  expect(ready.checks[2]).toEqual({
    code: 'media',
    ok: false,
    label: 'Media 1, 3 files are missing',
  });
});

test('readyChecks names the overflow and the missing file in one media row', () => {
  const ready = readyChecks({
    text: 'Hi',
    limit: 280,
    media: [
      { position: 1, present: false },
      { position: 2, present: true },
      { position: 3, present: true },
      { position: 4, present: true },
      { position: 5, present: true },
    ],
    accountConnected: true,
  });
  const row = ready.checks.find((check) => check.code === 'media');
  expect(ready.checks.filter((check) => check.code === 'media')).toHaveLength(1);
  expect(row).toEqual({
    code: 'media',
    ok: false,
    label: '5 of 4 images; Media 1 file is missing',
  });
});

test('promoteChecks reports several missing files in one message', () => {
  expect(
    promoteChecks({
      text: 'Hi',
      limit: 280,
      media: [
        { position: 1, present: false },
        { position: 2, present: true },
        { position: 3, present: false },
      ],
    }),
  ).toEqual([{ path: 'media', message: 'Media 1, 3 files are missing' }]);
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
