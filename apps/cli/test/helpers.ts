import path from 'node:path';

import type { TestServer } from '@perch/server/testing';

import type { CliContext } from '../src/context';

export function makeCtx(
  server: TestServer,
  over: Partial<CliContext> & {
    env?: Record<string, string>;
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
    argv: [],
    env: { PERCH_TOKEN: server.token, ...over.env },
    stdout: { write: (value) => void (stdout += value) },
    stderr: { write: (value) => void (stderr += value) },
    isTTY: false,
    stdinIsTTY: over.stdinIsTTY ?? false,
    configPath: path.join(server.dir, 'config.json'),
    fetch: ((input, init) =>
      server.app.request(new Request(input, init))) as typeof fetch,
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
