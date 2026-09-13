import { describe, expect, test } from 'bun:test';

import { resourceListQuerySchema } from '../src/resources';

describe('tagFilterSchema', () => {
  test('tag filter accepts one or many', () => {
    expect(resourceListQuerySchema.parse({ tag: 'a' }).tag).toEqual(['a']);
    expect(resourceListQuerySchema.parse({ tag: ['a', 'b'] }).tag).toEqual(['a', 'b']);
    expect(resourceListQuerySchema.parse({}).tag).toBeUndefined();
  });
});
