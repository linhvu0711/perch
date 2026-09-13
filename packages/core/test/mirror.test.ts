import { describe, expect, test } from 'bun:test';

import { mirrorFile, mirrorFileName, slugify } from '../src/mirror';
import type { Resource } from '../src/resources';

describe('slugify', () => {
  const cases: Array<[string, string]> = [
    ['Hello World', 'hello-world'],
    ['Đà Nẵng: tiếng Việt!', 'da-nang-tieng-viet'],
    ['', 'untitled'],
    ['###', 'untitled'],
    ['a'.repeat(70), 'a'.repeat(60)],
    ['  Spaced   out  ', 'spaced-out'],
  ];

  test.each(cases)('%p -> %p', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe('mirrorFileName', () => {
  test('builds file names from date, id, and slug', () => {
    expect(
      mirrorFileName({
        id: 7,
        title: 'Hello',
        created_at: '2026-09-04T10:00:00.000Z',
      }),
    ).toBe('2026-09-04-7-hello.md');
  });
});

describe('mirrorFile', () => {
  test('renders a note with front matter and body', () => {
    const resource: Resource = {
      id: 7,
      type: 'md',
      title: 'He said: "hi" #1',
      notes: 'why\nsaved',
      created_at: '2026-09-04T10:00:00.000Z',
      body: '# Hello',
      tags: [],
    };
    expect(mirrorFile(resource)).toEqual({
      path: 'notes/2026-09-04-7-he-said-hi-1.md',
      content:
        '---\nid: 7\ntype: "md"\ntitle: "He said: \\"hi\\" #1"\ncreated_at: "2026-09-04T10:00:00.000Z"\ntags: []\nnotes: |\n  why\n  saved\n---\n# Hello\n',
    });
  });

  test('writes empty notes as an empty string and skips other types', () => {
    const note: Resource = {
      id: 7,
      type: 'md',
      title: 'He said: "hi" #1',
      notes: '',
      created_at: '2026-09-04T10:00:00.000Z',
      body: '# Hello',
      tags: [],
    };
    const image: Resource = {
      id: 8,
      type: 'image',
      title: 'a.png',
      notes: '',
      created_at: '2026-09-04T10:00:00.000Z',
      path: '1/x.png',
      mime: 'image/png',
      bytes: 73,
      width: 3,
      height: 2,
      tags: [],
    };

    const file = mirrorFile(note);
    expect(file?.content).toContain('notes: ""\n');
    expect(file?.content).not.toContain('notes: |');
    expect(mirrorFile(image)).toBeNull();
  });
});
