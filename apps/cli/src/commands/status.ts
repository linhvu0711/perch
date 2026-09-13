import fs from 'node:fs';
import path from 'node:path';

import {
  formatCost,
  MIRROR_MANIFEST_FILE,
  type MirrorManifest,
  mirrorManifestSchema,
} from '@perch/core';
import type { Command } from 'commander';

import { createApi } from '../api';
import { resolveMirrorDir, resolveServerUrl, resolveToken } from '../config';
import type { CliContext } from '../context';
import { formatTable, printResult, resolveMode } from '../output';

interface GlobalOptions {
  json?: boolean;
  table?: boolean;
  server?: string;
}

function apiFor(program: Command, ctx: CliContext) {
  const options = program.opts<GlobalOptions>();
  return createApi(ctx, resolveServerUrl(ctx, options.server), resolveToken(ctx));
}

export function addStatusCommands(program: Command, ctx: CliContext): void {
  program
    .command('status')
    .description('Account, next posts, counts, month cost, mirror path')
    .action(async () => {
      const options = program.opts<GlobalOptions>();
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
      const lastPullAt = manifest?.pulled_at ?? null;

      const api = apiFor(program, ctx);
      const status = await api.call(api.client.api.status.$get());

      if (mode === 'json') {
        printResult(ctx, mode, { ...status, mirror_dir: dir, last_pull_at: lastPullAt });
        return;
      }

      ctx.stdout.write(
        `${formatTable({
          account: status.account !== null ? `@${status.account.username}` : 'none',
          missed: status.missed_count,
          failed: status.failed_count,
          month_cost: formatCost(status.month_cost_usd),
          mirror_dir: dir,
          last_pull_at: lastPullAt,
        })}\n\n`,
      );

      const rows = status.next_due.map((post) => ({
        id: post.id,
        status: post.status,
        when: post.scheduled_at ?? '',
        title: post.title,
      }));
      if (rows.length === 0) {
        ctx.stdout.write('no posts with a time from now on\n');
        return;
      }
      ctx.stdout.write(`${formatTable(rows)}\n`);
    });
}
