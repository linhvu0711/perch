import { describe, expect, test } from 'bun:test';

import {
  firstMarkdownHeading,
  noteCreateSchema,
  noteTitle,
  resourceDeleteBodySchema,
  resourceListQuerySchema,
  resourcePatchSchema,
} from '../src/resources';

describe('firstMarkdownHeading', () => {
  const cases: Array<[string, string | null]> = [
    ['# Hello', 'Hello'],
    ['intro\n\n## Second', 'Second'],
    ['#NoSpace', null],
    ['```\n# in code\n```\n# Real', 'Real'],
    ['# Trailing ##  ', 'Trailing'],
    ['   # three spaces', 'three spaces'],
    ['    # four spaces', null],
    ['', null],
    ['# \n# Next', 'Next'],
    ['# Win\r\nbody', 'Win'],
  ];

  test.each(cases)('%p -> %p', (body, expected) => {
    expect(firstMarkdownHeading(body)).toBe(expected);
  });
});

describe('noteTitle', () => {
  test('uses an explicit title first', () => {
    expect(noteTitle('# H', ' T ')).toBe('T');
  });

  test('falls through an empty explicit title', () => {
    expect(noteTitle('# H', '  ')).toBe('H');
  });

  test('uses Untitled when there is no heading', () => {
    expect(noteTitle('plain body')).toBe('Untitled');
  });
});

describe('resource schemas', () => {
  test('requires a note body', () => {
    expect(noteCreateSchema.safeParse({}).success).toBe(false);
  });

  test('rejects an over-limit derived title', () => {
    const result = noteCreateSchema.safeParse({ body: `# ${'x'.repeat(201)}` });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['title']);
  });

  test('rejects empty resource patches and titles', () => {
    expect(resourcePatchSchema.safeParse({}).success).toBe(false);
    expect(resourcePatchSchema.safeParse({ title: '' }).success).toBe(false);
  });

  test('applies list defaults and limit bounds', () => {
    expect(resourceListQuerySchema.parse({})).toEqual({
      sort: 'created',
      order: 'desc',
      limit: 50,
    });
    expect(resourceListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  test('requires at least one delete id', () => {
    expect(resourceDeleteBodySchema.safeParse({ ids: [] }).success).toBe(false);
  });
});
