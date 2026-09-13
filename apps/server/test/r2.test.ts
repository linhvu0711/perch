import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { fakeR2Client } from '../src/r2/fake';
import { restoreUploads } from '../src/r2/restore';
import { JPG_3X2, PNG_3X2 } from '../src/testing';

let dir: string;

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('restoreUploads', () => {
  test('restores every uploads/ object to the upload dir', async () => {
    // Given: a bucket with two upload objects and a Litestream replica object
    const r2 = fakeR2Client();
    r2.objects.set('uploads/1/a.png', PNG_3X2);
    r2.objects.set('uploads/1/posts/3/b.jpg', JPG_3X2);
    r2.objects.set('litestream/generations/x', new Uint8Array([1]));
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perch-r2-'));

    // When
    const restored = await restoreUploads(r2, dir);

    // Then: only the uploads/ keys land on disk
    expect(restored).toBe(2);
    expect(fs.statSync(path.join(dir, '1/a.png')).size).toBe(PNG_3X2.byteLength);
    expect(fs.statSync(path.join(dir, '1/posts/3/b.jpg')).size).toBe(JPG_3X2.byteLength);
    expect(fs.existsSync(path.join(dir, 'generations'))).toBe(false);
  });

  test('restores nothing when the bucket holds no uploads', async () => {
    // Given: a bucket with only a Litestream replica object
    const r2 = fakeR2Client();
    r2.objects.set('litestream/generations/x', new Uint8Array([1]));
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perch-r2-'));

    // When
    const restored = await restoreUploads(r2, dir);

    // Then
    expect(restored).toBe(0);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
