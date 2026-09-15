import path from 'node:path';

import type { TestServer } from '@perch/server/testing';

import { readConfig } from '../src/config';
import type { CliContext } from '../src/context';
import type { CliEnv } from '../src/env';

export function makeCtx(
  server: TestServer,
  over: Partial<CliContext> & {
    env?: CliEnv;
    stdin?: string;
    stdinIsTTY?: boolean;
    confirmAnswer?: boolean;
    editorResult?: string;
  } = {},
): {
  ctx: CliContext;
  out(): string;
  err(): string;
  opened: string[];
  confirms: string[];
  edits: string[];
} {
  let stdout = '';
  let stderr = '';
  const opened: string[] = [];
  const confirms: string[] = [];
  const edits: string[] = [];
  const ctx: CliContext = {
    env: { PERCH_TOKEN: server.token, ...over.env },
    stdout: {
      write: (value) => {
        stdout += value;
      },
    },
    stderr: {
      write: (value) => {
        stderr += value;
      },
    },
    isTTY: false,
    stdinIsTTY: over.stdinIsTTY ?? false,
    configPath: path.join(server.dir, 'config.json'),
    readConfig: () => readConfig(ctx.configPath),
    homeDir: server.dir,
    now: () => new Date('2026-09-04T10:00:00Z'),
    fetch: ((input, init) => server.app.request(new Request(input, init))) as typeof fetch,
    openUrl: async (url) => {
      opened.push(url);
    },
    readStdin: async () => over.stdin ?? '',
    confirm: async (question) => {
      confirms.push(question);
      return over.confirmAnswer ?? false;
    },
    editText: async (initial) => {
      edits.push(initial);
      return over.editorResult ?? initial;
    },
    ...over,
  };
  ctx.env = { PERCH_TOKEN: server.token, ...over.env };

  return {
    ctx,
    out: () => stdout,
    err: () => stderr,
    opened,
    confirms,
    edits,
  };
}
