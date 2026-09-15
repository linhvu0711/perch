import type { Command } from 'commander';

import { run } from '../cli';
import type { CliContext } from '../context';
import { CliError } from '../output';

export function addAccountCommands(program: Command, ctx: CliContext): void {
  const account = program.command('account').description('Manage the connected X account');

  account
    .command('show')
    .description('Show the connected X account')
    .action(
      run(ctx, async ({ api }) => {
        const status = await api.call(api.client.api.account.$get());

        return {
          value: status.account
            ? {
                connected: true,
                username: status.account.username,
                x_user_id: status.account.x_user_id,
                subscription_type: status.account.subscription_type,
                char_limit: status.char_limit,
                connected_at: status.account.connected_at,
                reconnect_required: status.account.reconnect_required,
              }
            : { connected: false, char_limit: status.char_limit },
        };
      }),
    );

  account
    .command('disconnect')
    .description('Revoke the X token at X and disconnect')
    .action(
      run(ctx, async ({ api, confirmOrRefuse }) => {
        const status = await api.call(api.client.api.account.$get());
        if (!status.account) {
          throw new CliError('not_found', 'No X account connected');
        }

        if (
          !(await confirmOrRefuse(
            `Disconnect @${status.account.username}? This revokes the token at X.`,
            'Refusing to disconnect without --yes',
          ))
        ) {
          return undefined;
        }

        await api.call(api.client.api.account.disconnect.$post());
        return { value: { disconnected: true } };
      }),
    );
}
