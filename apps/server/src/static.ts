import fs from 'node:fs';
import path from 'node:path';

import type { Handler } from 'hono';

import { notFoundHandler } from './errors';

export function staticHandler(webDist: string): Handler {
  return async (c) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      return notFoundHandler(c);
    }

    let pathname: string;
    try {
      pathname = path.normalize(decodeURIComponent(new URL(c.req.url).pathname));
    } catch {
      pathname = '/';
    }

    const candidate = path.join(webDist, pathname);
    const inside = candidate === webDist || candidate.startsWith(webDist + path.sep);

    if (inside && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return new Response(Bun.file(candidate), {
        headers: {
          'Cache-Control': pathname.startsWith('/assets/')
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        },
      });
    }

    const index = path.join(webDist, 'index.html');
    if (fs.existsSync(index) && fs.statSync(index).isFile()) {
      return new Response(Bun.file(index), {
        headers: {
          'Cache-Control': 'no-cache',
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    }

    return c.json(
      {
        code: 'internal',
        message: 'Web app is not built. Run `bun run build`.',
      },
      503,
    );
  };
}
