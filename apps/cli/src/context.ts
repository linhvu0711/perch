import os from 'node:os';
import path from 'node:path';

export interface CliContext {
  argv: string[];
  env: Record<string, string | undefined>;
  stdout: { write(s: string): void };
  stderr: { write(s: string): void };
  isTTY: boolean;
  configPath: string;
  fetch: typeof fetch;
  openUrl: (url: string) => Promise<void>;
}

export function realContext(argv: string[]): CliContext {
  const env = process.env;
  return {
    argv,
    env,
    stdout: process.stdout,
    stderr: process.stderr,
    isTTY: Boolean(process.stdout.isTTY),
    configPath:
      env.PERCH_CONFIG_PATH ?? path.join(os.homedir(), '.perch', 'config.json'),
    fetch: globalThis.fetch,
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
