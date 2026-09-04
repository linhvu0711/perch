import { describe, expect, test } from 'bun:test';

import { formatTable, resolveMode } from '../src/output';

describe('CLI output', () => {
  test('formats objects as key-value rows', () => {
    expect(formatTable({ a: 1, bb: 'x' })).toBe('a   1\nbb  x');
  });

  test('formats arrays of objects as aligned tables', () => {
    expect(
      formatTable([
        { a: 1, bb: 'x' },
        { a: 22, bb: 'y' },
      ]),
    ).toBe('a   bb\n1   x\n22  y');
  });

  test('resolves explicit and implicit output modes', () => {
    expect(resolveMode({ json: true, table: true }, true)).toBe('json');
    expect(resolveMode({}, false)).toBe('json');
    expect(resolveMode({}, true)).toBe('table');
  });
});
