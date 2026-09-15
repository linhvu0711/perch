import type { Tag } from '@perch/core';
import type { Command } from 'commander';

import { run } from '../cli';
import type { CliContext } from '../context';
import { CliError, formatTable } from '../output';

interface TagDeleteResult {
  name: string;
  ok: boolean;
  error?: { code: string; message: string };
}

type TagCreateResult =
  | { name: string; ok: true; tag: Tag }
  | { name: string; ok: false; error: { code: string; message: string } };

export function addTagCommands(program: Command, ctx: CliContext): void {
  const tag = program.command('tag').description('Manage tags');

  tag
    .command('list')
    .description('List tags')
    .action(
      run(ctx, async ({ api }) => {
        const result = await api.call(api.client.api.tags.$get());

        const rows = result.items.map((item) => ({
          name: item.name,
          resources: item.resource_count,
          posts: item.post_count,
        }));
        const summary = `${result.items.length} shown · ${result.total} total`;

        return {
          value: result,
          table: rows.length === 0 ? summary : `${formatTable(rows)}\n\n${summary}`,
        };
      }),
    );

  tag
    .command('create <name...>')
    .description('Create tags')
    .action(
      run(ctx, async ({ api }, names: string[]) => {
        const results: TagCreateResult[] = [];
        for (const name of names) {
          try {
            const created = await api.call(api.client.api.tags.$post({ json: { name } }));
            results.push({ name, ok: true, tag: created });
          } catch (error) {
            if (!(error instanceof CliError)) throw error;
            if (error.code === 'unreachable' || error.code === 'unauthorized') throw error;
            results.push({
              name,
              ok: false,
              error: { code: error.code, message: error.message },
            });
          }
        }

        return {
          batch: results,
          table: results.map((result) => ({
            name: result.name,
            ok: result.ok,
            id: result.ok ? result.tag.id : '',
            error: result.ok ? '' : result.error.message,
          })),
        };
      }),
    );

  tag
    .command('rename <old> <new>')
    .description('Rename a tag everywhere')
    .action(
      run(ctx, async ({ api }, old: string, name: string) => {
        const list = await api.call(api.client.api.tags.$get());
        const found = list.items.find((item) => item.name.toLowerCase() === old.toLowerCase());
        if (!found) throw new CliError('not_found', `Tag "${old}" not found`);
        const renamed = await api.call(
          api.client.api.tags[':id'].$patch({
            param: { id: String(found.id) },
            json: { name },
          }),
        );
        return { value: renamed };
      }),
    );

  tag
    .command('delete <name...>')
    .description('Delete tags and remove them from everything')
    .action(
      run(ctx, async ({ api, confirmOrRefuse }, names: string[]) => {
        if (
          !(await confirmOrRefuse(
            `Delete ${names.length} tag${names.length === 1 ? '' : 's'} (${names.join(', ')})?`,
            'Refusing to delete without --yes',
          ))
        ) {
          return undefined;
        }

        const list = await api.call(api.client.api.tags.$get());
        const byName = new Map(list.items.map((item) => [item.name.toLowerCase(), item.id]));
        const known = names.filter((name) => byName.has(name.toLowerCase()));
        const ids = [
          ...new Set(
            known
              .map((n) => byName.get(n.toLowerCase()))
              .filter((id): id is number => id !== undefined),
          ),
        ];

        const deleted = new Map<number, { id: number; ok: boolean }>();
        if (ids.length > 0) {
          const response = await api.call(
            api.client.api.tags.$delete({
              json: { ids },
            }),
          );
          for (const result of response.results) deleted.set(result.id, result);
        }

        const results: TagDeleteResult[] = names.map((name) => {
          const id = byName.get(name.toLowerCase());
          if (id === undefined) {
            return {
              name,
              ok: false,
              error: { code: 'not_found', message: `Tag "${name}" not found` },
            };
          }
          const result = deleted.get(id);
          return result?.ok === false
            ? { name, ok: false, error: { code: 'not_found', message: `Tag "${name}" not found` } }
            : { name, ok: true };
        });

        return { batch: results };
      }),
    );
}
