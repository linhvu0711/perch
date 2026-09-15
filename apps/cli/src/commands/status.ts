import fs from 'node:fs';
import path from 'node:path';

import {
  formatCost,
  MIRROR_MANIFEST_FILE,
  type MirrorManifest,
  mirrorManifestSchema,
} from '@perch/core';
import type { Command } from 'commander';

import { run } from '../cli';
import { resolveMirrorDir } from '../config';
import type { CliContext } from '../context';
import { formatTable } from '../output';

export function addStatusCommands(program: Command, ctx: CliContext): void {
  program
    .command('status')
    .description('Account, next posts, counts, month cost, mirror path')
    .action(
      run(ctx, async ({ api, config }) => {
        const dir = resolveMirrorDir(ctx, config);

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

        const status = await api.call(api.client.api.status.$get());

        const rows = status.next_due.map((post) => ({
          id: post.id,
          status: post.status,
          when: post.scheduled_at ?? '',
          title: post.title,
        }));

        return {
          value: { ...status, mirror_dir: dir, last_pull_at: lastPullAt },
          table: `${formatTable({
            account: status.account !== null ? `@${status.account.username}` : 'none',
            missed: status.missed_count,
            failed: status.failed_count,
            month_cost: formatCost(status.month_cost_usd),
            mirror_dir: dir,
            last_pull_at: lastPullAt,
          })}\n\n${
            rows.length === 0 ? 'no posts with a time from now on' : formatTable(rows)
          }`,
        };
      }),
    );
}
