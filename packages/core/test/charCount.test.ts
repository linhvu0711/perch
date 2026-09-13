import { describe, expect, test } from 'bun:test';

import { foldPreview, previewSegments, weightedLength } from '../src/charCount';

describe('weightedLength', () => {
  const cases: Array<[string, number]> = [
    ['Hello world', 11],
    ['こんにちは', 10],
    ['see https://example.com/a/very/long/path/here now', 31],
    ['example.com', 23],
    ['@bob #tag', 9],
    ['👍', 2],
    ['', 0],
    ['a'.repeat(281), 281],
  ];

  test.each(cases)('%p -> %p', (text, expected) => {
    expect(weightedLength(text)).toBe(expected);
  });
});

describe('previewSegments', () => {
  test('splits text into url, mention, and hashtag segments', () => {
    expect(previewSegments('Check https://x.com @bob #news')).toEqual([
      { kind: 'text', text: 'Check ' },
      { kind: 'url', text: 'https://x.com' },
      { kind: 'text', text: ' ' },
      { kind: 'mention', text: '@bob' },
      { kind: 'text', text: ' ' },
      { kind: 'hashtag', text: '#news' },
    ]);
    expect(previewSegments('')).toEqual([]);
    expect(previewSegments('plain')).toEqual([{ kind: 'text', text: 'plain' }]);
  });

  test('keeps mentions inside URLs inside the url segment', () => {
    expect(previewSegments('https://e.com/@m')).toEqual([
      { kind: 'url', text: 'https://e.com/@m' },
    ]);
    expect(previewSegments('see https://x.com/@user now')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'url', text: 'https://x.com/@user' },
      { kind: 'text', text: ' now' },
    ]);
  });
});

describe('foldPreview', () => {
  test('folds text past the fold point', () => {
    expect(foldPreview('a'.repeat(280))).toEqual({
      visible: 'a'.repeat(280),
      folded: false,
    });
    expect(foldPreview('a'.repeat(281))).toEqual({
      visible: 'a'.repeat(280),
      folded: true,
    });
    expect(foldPreview('word '.repeat(60).trim())).toEqual({
      visible: 'word '.repeat(55) + 'word',
      folded: true,
    });
  });
});
