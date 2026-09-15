import {
  calendarMark,
  isValidDate,
  monthOf,
  postCalendarTime,
  weekOf,
  zonedParts,
} from '@perch/core';
import type { Command } from 'commander';

import { run } from '../cli';
import type { CliContext } from '../context';
import { formatTable, UsageError } from '../output';

export function addCalendarCommands(program: Command, ctx: CliContext): void {
  program
    .command('calendar')
    .description('Posts by day for a week or a month')
    .option('--week')
    .option('--month')
    .option('--from <date>')
    .option('--tag <name...>')
    .action(
      run(
        ctx,
        async (
          { api },
          commandOptions: {
            week?: boolean;
            month?: boolean;
            from?: string;
            tag?: string[];
          },
        ) => {
          if (commandOptions.week === true && commandOptions.month === true) {
            throw new UsageError('usage', 'Use one of --week or --month');
          }
          if (commandOptions.from !== undefined && !isValidDate(commandOptions.from)) {
            throw new UsageError('usage', '--from must be YYYY-MM-DD');
          }

          const settings = await api.call(api.client.api.settings.$get());
          const anchor = commandOptions.from ?? zonedParts(ctx.now(), settings.timezone).date;
          const range = commandOptions.week === true ? weekOf(anchor) : monthOf(anchor);
          const result = await api.call(
            api.client.api.calendar.$get({
              query: {
                from: range.from,
                to: range.to,
                ...(commandOptions.tag !== undefined ? { tag: commandOptions.tag } : {}),
              },
            }),
          );

          const rows: Array<{
            day: string;
            time: string;
            id: number;
            status: string;
            mark: string;
            title: string;
          }> = [];
          for (const day of result.days) {
            for (const post of day.posts) {
              const at = postCalendarTime(post);
              rows.push({
                day: day.date,
                time: at === null ? '' : zonedParts(new Date(at), settings.timezone).time,
                id: post.id,
                status: post.status,
                mark: calendarMark(post),
                title: post.title,
              });
            }
          }
          const summary = `${rows.length} posts · ${range.from} – ${range.to}`;

          return {
            value: result,
            table: rows.length === 0 ? summary : `${formatTable(rows)}\n\n${summary}`,
          };
        },
      ),
    );
}
