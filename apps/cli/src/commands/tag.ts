import type { Tag } from '@perch/core';
import type { Command } from 'commander';

import { createApi } from '../api';
import { resolveServerUrl, resolveToken } from '../config';
import type { CliContext } from '../context';
import { BatchFailure, CliError, formatTable, printResult, resolveMode } from '../output';

interface GlobalOptions {
  json?: boolean;
  table?: boolean;
  server?: string;
  yes?: boolean;
}

interface TagDeleteResult {
  name: string;
  ok: boolean;
  error?: { code: string; message: string };
}

type TagCreateResult =
  | { name: string; ok: true; tag: Tag }
  | { name: string; ok: false; error: { code: string; message: string } };

function apiFor(program: Command, ctx: CliContext) {
  const options = program.opts<GlobalOptions>();
  return createApi(ctx, resolveServerUrl(ctx, options.server), resolveToken(ctx));
}

export function addTagCommands(program: Command, ctx: CliContext): void {
  const tag = program.command('tag').description('Manage tags');

  tag
    .command('list')
    .description('List tags')
    .action(async () => {
      const options = program.opts<GlobalOptions>();
      const api = apiFor(program, ctx);
      const result = await api.call(api.client.api.tags.$get());
      const mode = resolveMode(options, ctx.isTTY);
      if (mode === 'json') {
        printResult(ctx, mode, result);
        return;
      }

      const rows = result.items.map((item) => ({
        name: item.name,
        resources: item.resource_count,
        posts: item.post_count,
      }));
      const summary = `${result.items.length} shown · ${result.total} total`;
      if (rows.length === 0) {
        ctx.stdout.write(`${summary}\n`);
        return;
      }
      ctx.stdout.write(`${formatTable(rows)}\n\n${summary}\n`);
    });

  tag
    .command('create <name...>')
    .description('Create tags')
    .action(async (names: string[]) => {
      const options = program.opts<GlobalOptions>();
      const api = apiFor(program, ctx);
      const results: TagCreateResult[] = [];
      for (const name of names) {
        try {
          const created = await api.call(api.client.api.tags.$post({ json: { name } }));
          results.push({ name, ok: true, tag: created });
        } catch (error) {
          if (!(error instanceof CliError)) throw error;
          results.push({
            name,
            ok: false,
            error: { code: error.code, message: error.message },
          });
        }
      }

      const mode = resolveMode(options, ctx.isTTY);
      if (mode === 'json') {
        printResult(ctx, mode, results);
      } else {
        printResult(
          ctx,
          mode,
          results.map((result) => ({
            name: result.name,
            ok: result.ok,
            id: result.ok ? result.tag.id : '',
            error: result.ok ? '' : result.error.message,
          })),
        );
      }

      const failed = results.filter((result) => !result.ok).length;
      if (failed > 0) throw new BatchFailure(failed, results.length);
    });

  tag
    .command('rename <old> <new>')
    .description('Rename a tag everywhere')
    .action(async (old: string, name: string) => {
      const options = program.opts<GlobalOptions>();
      const api = apiFor(program, ctx);
      const list = await api.call(api.client.api.tags.$get());
      const found = list.items.find((item) => item.name.toLowerCase() === old.toLowerCase());
      if (!found) throw new CliError('not_found', `Tag "${old}" not found`);
      const renamed = await api.call(
        api.client.api.tags[':id'].$patch({
          param: { id: String(found.id) },
          json: { name },
        }),
      );
      printResult(ctx, resolveMode(options, ctx.isTTY), renamed);
    });

  tag
    .command('delete <name...>')
    .description('Delete tags and remove them from everything')
    .action(async (names: string[]) => {
      const options = program.opts<GlobalOptions>();

      if (!options.yes) {
        if (!ctx.isTTY || !ctx.stdinIsTTY) {
          throw new CliError('confirm_required', 'Refusing to delete without --yes');
        }
        const confirmed = await ctx.confirm(
          `Delete ${names.length} tag${names.length === 1 ? '' : 's'} (${names.join(', ')})?`,
        );
        if (!confirmed) {
          ctx.stderr.write('Cancelled\n');
          return;
        }
      }

      const api = apiFor(program, ctx);
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

      const mode = resolveMode(options, ctx.isTTY);
      printResult(ctx, mode, results);

      const failed = results.filter((result) => !result.ok).length;
      if (failed > 0) throw new BatchFailure(failed, results.length);
    });
}
