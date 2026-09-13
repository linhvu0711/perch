import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

import { fixedClock } from './clock';
import { buildServer, type PerchServer } from './server';
import { type FakeXClient, fakeXClient } from './x/fake';

export interface TestServer extends PerchServer {
  token: string;
  clock: ReturnType<typeof fixedClock>;
  xClient: FakeXClient;
  dir: string;
  webDist: string;
  cleanup(): void;
}

export async function createTestServer(opts?: {
  indexHtml?: string;
  now?: Date;
  secureCookies?: boolean;
  xOAuthConfigured?: boolean;
}): Promise<TestServer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perch-test-'));
  const dbPath = path.join(dir, 'perch.db');
  const uploadDir = path.join(dir, 'uploads');
  const webDist = path.join(dir, 'web');
  fs.mkdirSync(webDist, { recursive: true });
  fs.writeFileSync(
    path.join(webDist, 'index.html'),
    opts?.indexHtml ?? '<!doctype html><div id="root">perch-test-app</div>',
  );

  const clock = fixedClock(opts?.now ?? new Date('2026-09-04T10:00:00Z'));
  const xClient = fakeXClient();
  const token = 'test-token';
  const server = await buildServer({
    dbPath,
    uploadDir,
    clock,
    xClient,
    token,
    secureCookies: opts?.secureCookies ?? false,
    webDist,
    xOAuth:
      opts?.xOAuthConfigured === false
        ? null
        : {
            clientId: 'test-client-id',
            redirectUri: 'http://127.0.0.1:3000/auth/x/callback',
            authorizeUrl: 'https://x.com/i/oauth2/authorize',
          },
  });

  return {
    ...server,
    token,
    clock,
    xClient,
    dir,
    webDist,
    cleanup() {
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

const PNG_3X2_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEElEQVR4nGP4z8AAQQxwFgBB0gX7h/C5SAAAAABJRU5ErkJggg==';
const JPG_3X2_B64 =
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAA6ADAAQAAAABAAAAAgAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAgADAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+L6KKK/lM/38P//Z';
const WEBP_3X2_B64 =
  'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoDAAIAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=';
const GIF_4X3_B64 =
  'R0lGODlhBAADAPcfAAAAACQAAEgAAGwAAJAAALQAANgAAPwAAAAkACQkAEgkAGwkAJAkALQkANgkAPwkAABIACRIAEhIAGxIAJBIALRIANhIAPxIAABsACRsAEhsAGxsAJBsALRsANhsAPxsAACQACSQAEiQAGyQAJCQALSQANiQAPyQAAC0ACS0AEi0AGy0AJC0ALS0ANi0APy0AADYACTYAEjYAGzYAJDYALTYANjYAPzYAAD8ACT8AEj8AGz8AJD8ALT8ANj8APz8AAAAVSQAVUgAVWwAVZAAVbQAVdgAVfwAVQAkVSQkVUgkVWwkVZAkVbQkVdgkVfwkVQBIVSRIVUhIVWxIVZBIVbRIVdhIVfxIVQBsVSRsVUhsVWxsVZBsVbRsVdhsVfxsVQCQVSSQVUiQVWyQVZCQVbSQVdiQVfyQVQC0VSS0VUi0VWy0VZC0VbS0Vdi0Vfy0VQDYVSTYVUjYVWzYVZDYVbTYVdjYVfzYVQD8VST8VUj8VWz8VZD8VbT8Vdj8Vfz8VQAAqiQAqkgAqmwAqpAAqrQAqtgAqvwAqgAkqiQkqkgkqmwkqpAkqrQkqtgkqvwkqgBIqiRIqkhIqmxIqpBIqrRIqthIqvxIqgBsqiRsqkhsqmxsqpBsqrRsqthsqvxsqgCQqiSQqkiQqmyQqpCQqrSQqtiQqvyQqgC0qiS0qki0qmy0qpC0qrS0qti0qvy0qgDYqiTYqkjYqmzYqpDYqrTYqtjYqvzYqgD8qiT8qkj8qmz8qpD8qrT8qtj8qvz8qgAA/yQA/0gA/2wA/5AA/7QA/9gA//wA/wAk/yQk/0gk/2wk/5Ak/7Qk/9gk//wk/wBI/yRI/0hI/2xI/5BI/7RI/9hI//xI/wBs/yRs/0hs/2xs/5Bs/7Rs/9hs//xs/wCQ/ySQ/0iQ/2yQ/5CQ/7SQ/9iQ//yQ/wC0/yS0/0i0/2y0/5C0/7S0/9i0//y0/wDY/yTY/0jY/2zY/5DY/7TY/9jY//zY/wD8/yT8/0j8/2z8/5D8/7T8/9j8//z8/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQEBAAfACwAAAAABAADAAAICAAPCBxIUGBAADs=';

export const PNG_3X2 = new Uint8Array(Buffer.from(PNG_3X2_B64, 'base64'));
export const JPG_3X2 = new Uint8Array(Buffer.from(JPG_3X2_B64, 'base64'));
export const WEBP_3X2 = new Uint8Array(Buffer.from(WEBP_3X2_B64, 'base64'));
export const GIF_4X3 = new Uint8Array(Buffer.from(GIF_4X3_B64, 'base64'));

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

export function makePng(
  width: number,
  height: number,
  rgb: [number, number, number] = [70, 130, 180],
): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);

  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * 3;
      raw[offset] = rgb[0];
      raw[offset + 1] = rgb[1];
      raw[offset + 2] = rgb[2];
    }
  }
  const idat = new Uint8Array(deflateSync(raw));

  const out = new Uint8Array(
    signature.length +
      pngChunk('IHDR', ihdr).length +
      pngChunk('IDAT', idat).length +
      pngChunk('IEND', new Uint8Array(0)).length,
  );
  let offset = 0;
  const write = (part: Uint8Array) => {
    out.set(part, offset);
    offset += part.length;
  };
  write(signature);
  write(pngChunk('IHDR', ihdr));
  write(pngChunk('IDAT', idat));
  write(pngChunk('IEND', new Uint8Array(0)));
  return out;
}
