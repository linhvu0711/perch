import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

import { CliError } from './output';

export interface CliContext {
  argv: string[];
  env: Record<string, string | undefined>;
  stdout: { write(s: string): void };
  stderr: { write(s: string): void };
  isTTY: boolean;
  stdinIsTTY: boolean;
  configPath: string;
  homeDir: string;
  now: () => Date;
  fetch: typeof fetch;
  openUrl: (url: string) => Promise<void>;
  readStdin(): Promise<string>;
  confirm(question: string): Promise<boolean>;
  editText(initial: string): Promise<string>;
}

export function realContext(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): CliContext {
  return {
    argv,
    env,
    stdout: process.stdout,
    stderr: process.stderr,
    isTTY: Boolean(process.stdout.isTTY),
    stdinIsTTY: Boolean(process.stdin.isTTY),
    configPath:
      env.PERCH_CONFIG_PATH ?? path.join(os.homedir(), '.perch', 'config.json'),
    homeDir: os.homedir(),
    now: () => new Date(),
    fetch: globalThis.fetch,
    readStdin: () => Bun.stdin.text(),
    async confirm(question: string) {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        const answer = await rl.question(`${question} [y/N] `);
        return /^y(es)?$/i.test(answer);
      } finally {
        rl.close();
      }
    },
    async editText(initial: string) {
      const editor = env.VISUAL ?? env.EDITOR;
      if (!editor) {
        throw new CliError('no_editor', 'Set $EDITOR (or $VISUAL) to use -e');
      }

      const file = path.join(os.tmpdir(), `perch-${crypto.randomUUID()}.md`);
      fs.writeFileSync(file, initial, { encoding: 'utf8', mode: 0o600 });
      try {
        const result = Bun.spawnSync([...editor.split(/\s+/), file], {
          stdin: 'inherit',
          stdout: 'inherit',
          stderr: 'inherit',
        });
        if (result.exitCode !== 0) {
          throw new CliError(
            'editor_failed',
            `Editor exited with code ${result.exitCode}`,
          );
        }
        return fs.readFileSync(file, 'utf8');
      } finally {
        fs.rmSync(file, { force: true });
      }
    },
    async openUrl(url: string) {
      try {
        const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
        const child = Bun.spawn([command, url], {
          stdout: 'ignore',
          stderr: 'ignore',
        });
        await child.exited;
      } catch {
        // Printing the URL is sufficient when no opener is available.
      }
    },
  };
}
