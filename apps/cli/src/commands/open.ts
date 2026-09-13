import type { Command } from 'commander';

import { createApi } from '../api';
import { resolveServerUrl, resolveToken } from '../config';
import type { CliContext } from '../context';
import { CliError, printResult, resolveMode } from '../output';

interface GlobalOptions {
  json?: boolean;
  table?: boolean;
  server?: string;
}

function positiveId(value: string): number {
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw new CliError('bad_args', 'id must be a positive integer');
  }
  return Number(value);
}

export function addOpenCommands(program: Command, ctx: CliContext): void {
  const open = program.command('open').description('Open a page in the web app');

  for (const kind of ['post', 'resource'] as const) {
    open
      .command(`${kind} <id>`)
      .description(`Open a ${kind} in the web app`)
      .action(async (idValue: string) => {
        const id = positiveId(idValue);
        const options = program.opts<GlobalOptions>();
        const serverUrl = resolveServerUrl(ctx, options.server);
        const api = createApi(ctx, serverUrl, resolveToken(ctx));

        if (kind === 'post') {
          await api.call(api.client.api.posts[':id'].$get({ param: { id: String(id) } }));
        } else {
          await api.call(api.client.api.resources[':id'].$get({ param: { id: String(id) } }));
        }

        const url = `${serverUrl}/${kind}s/${id}`;
        printResult(ctx, resolveMode(options, ctx.isTTY), { url });
        if (ctx.isTTY) await ctx.openUrl(url);
      });
  }
}
