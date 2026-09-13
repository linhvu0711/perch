import { describe, expect, test } from 'bun:test';

import {
  DEMOTE_FROM,
  PROMOTE_FROM,
  promoteChecks,
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
