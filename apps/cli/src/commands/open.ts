import type { Command } from 'commander';

import { positiveId, run } from '../cli';
import type { CliContext } from '../context';

export function addOpenCommands(program: Command, ctx: CliContext): void {
  const open = program.command('open').description('Open a page in the web app');

  for (const kind of ['post', 'resource'] as const) {
    open
      .command(`${kind} <id>`)
      .description(`Open a ${kind} in the web app`)
      .action(
        run(ctx, async ({ api, serverUrl }, idValue: string) => {
          const id = positiveId(idValue);

          if (kind === 'post') {
            await api.call(api.client.api.posts[':id'].$get({ param: { id: String(id) } }));
          } else {
            await api.call(api.client.api.resources[':id'].$get({ param: { id: String(id) } }));
          }

          const url = `${serverUrl}/${kind}s/${id}`;
          if (ctx.isTTY) await ctx.openUrl(url);
          return { value: { url } };
        }),
      );
  }
}
