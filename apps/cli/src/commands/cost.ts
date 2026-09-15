import { costMonthSchema, formatCost } from '@perch/core';
import type { Command } from 'commander';

import { run } from '../cli';
import type { CliContext } from '../context';
import { UsageError } from '../output';

export function addCostCommands(program: Command, ctx: CliContext): void {
  program
    .command('cost')
    .description("This month's X cost split by kind")
    .option('--month <YYYY-MM>')
    .action(
      run(ctx, async ({ api }, commandOptions: { month?: string }) => {
        if (
          commandOptions.month !== undefined &&
          !costMonthSchema.safeParse(commandOptions.month).success
        ) {
          throw new UsageError('usage', '--month must be YYYY-MM');
        }

        const result = await api.call(
          api.client.api.costs.summary.$get({
            query: commandOptions.month !== undefined ? { month: commandOptions.month } : {},
          }),
        );

        return {
          value: result,
          table: {
            month: result.month,
            calls: result.calls,
            publish: formatCost(result.publish_usd),
            save_tweet: formatCost(result.save_tweet_usd),
            connect: formatCost(result.connect_usd),
            total: formatCost(result.total_usd),
            all_time: formatCost(result.all_time_usd),
          },
        };
      }),
    );
}
