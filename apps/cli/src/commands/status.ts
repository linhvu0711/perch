import fs from 'node:fs';
import path from 'node:path';

import {
  MIRROR_MANIFEST_FILE,
  mirrorManifestSchema,
  type MirrorManifest,
} from '@perch/core';
import type { Command } from 'commander';

import { resolveMirrorDir } from '../config';
import type { CliContext } from '../context';
import { printResult, resolveMode } from '../output';

export function addStatusCommands(program: Command, ctx: CliContext): void {
  program
    .command('status')
    .description('Mirror path and last pull time')
    .action(() => {
      const options = program.opts<{ json?: boolean; table?: boolean }>();
      const mode = resolveMode(options, ctx.isTTY);
      const dir = resolveMirrorDir(ctx);

      let manifest: MirrorManifest | null = null;
      const manifestPath = path.join(dir, MIRROR_MANIFEST_FILE);
      if (fs.existsSync(manifestPath)) {
        try {
          const parsed = mirrorManifestSchema.safeParse(
            JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
          );
          manifest = parsed.success ? parsed.data : null;
        } catch {
          manifest = null;
        }
      }

      printResult(ctx, mode, {
        mirror_dir: dir,
        last_pull_at: manifest?.pulled_at ?? null,
      });
    });
}
