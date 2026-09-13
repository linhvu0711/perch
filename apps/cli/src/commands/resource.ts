import fs from 'node:fs';
import path from 'node:path';

import {
  firstMarkdownHeading,
  type ItemTagsResponse,
  isValidDate,
  RESOURCE_LIST_LIMIT_DEFAULT,
  RESOURCE_LIST_LIMIT_MAX,
  RESOURCE_TYPES,
  type Resource,
  type ResourcePatch,
  type ResourceType,
  resourceListQuerySchema,
  resourceSchema,
} from '@perch/core';
import type { Command } from 'commander';

import { createApi } from '../api';
import { resolveMirrorDir, resolveServerUrl, resolveToken } from '../config';
import type { CliContext } from '../context';
import { applyMirror } from '../mirror';
import { BatchFailure, CliError, formatTable, printResult, resolveMode } from '../output';

interface GlobalOptions {
  json?: boolean;
  table?: boolean;
  server?: string;
  yes?: boolean;
}

function apiFor(program: Command, ctx: CliContext) {
  const options = program.opts<GlobalOptions>();
  return createApi(ctx, resolveServerUrl(ctx, options.server), resolveToken(ctx));
}

function positiveId(value: string, plural = false): number {
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw new CliError(
      'bad_args',
      plural ? 'ids must be positive integers' : 'id must be a positive integer',
    );
  }
  return Number(value);
}

function printResource(ctx: CliContext, options: GlobalOptions, resource: Resource): void {
  const mode = resolveMode(options, ctx.isTTY);
  if (mode === 'json') {
    printResult(ctx, mode, resource);
    return;
  }

  if (resource.type === 'image') {
    ctx.stdout.write(
      `${formatTable({
        id: resource.id,
        type: resource.type,
        title: resource.title,
        notes: resource.notes,
        created: resource.created_at,
        path: resource.path,
        mime: resource.mime,
        bytes: resource.bytes,
        width: resource.width,
        height: resource.height,
        tags: resource.tags.join(', '),
      })}\n`,
    );
    return;
  }
  if (resource.type === 'tweet') {
    ctx.stdout.write(
      `${formatTable({
        id: resource.id,
        type: resource.type,
        title: resource.title,
        author: `@${resource.author_username}`,
        posted: resource.posted_at,
        url: resource.url,
        notes: resource.notes,
        created: resource.created_at,
        tags: resource.tags.join(', '),
      })}\n\n${resource.text}\n`,
    );
    return;
  }

  ctx.stdout.write(
    `${formatTable({
      id: resource.id,
      type: resource.type,
      title: resource.title,
      notes: resource.notes,
      created: resource.created_at,
      tags: resource.tags.join(', '),
    })}\n\n${resource.body}\n`,
  );
}

export function addResourceCommands(program: Command, ctx: CliContext): void {
  const resource = program.command('resource').description('Manage resources');

  const add = resource.command('add').description('Add a resource');

  add
    .command('tweet <urls...>')
    .description('Save tweets from X URLs')
    .option('--refresh', 're-fetch a saved tweet')
    .option('--tag <name...>')
    .action(async (urls: string[], commandOptions: { refresh?: boolean; tag?: string[] }) => {
      const options = program.opts<GlobalOptions>();
      const api = apiFor(program, ctx);
      const response = await api.call(
        api.client.api.resources.tweets.$post({
          json: {
            urls,
            refresh: commandOptions.refresh ?? false,
            ...(commandOptions.tag !== undefined ? { tags: commandOptions.tag } : {}),
          },
        }),
      );
      const mode = resolveMode(options, ctx.isTTY);
      if (mode === 'json') {
        printResult(ctx, mode, response.results);
      } else {
        printResult(
          ctx,
          mode,
          response.results.map((result) => ({
            url: result.url,
            id: result.ok ? result.resource.id : '',
            status: result.ok ? result.status : '',
            author: result.ok ? `@${result.resource.author_username}` : '',
            error: result.ok ? '' : result.error.message,
          })),
        );
      }
      const failed = response.results.filter((result) => !result.ok).length;
      if (failed > 0) throw new BatchFailure(failed, response.results.length);
    });

  add
    .command('md <path...>')
    .description('Add Markdown notes')
    .option('--title <title>')
    .option('--tag <name...>')
    .action(async (paths: string[], commandOptions: { title?: string; tag?: string[] }) => {
      const options = program.opts<GlobalOptions>();
      const mode = resolveMode(options, ctx.isTTY);
      const stdinCount = paths.filter((item) => item === '-').length;
      if (stdinCount > 1) {
        throw new CliError('bad_args', 'stdin (-) may be given only once');
      }
      if (commandOptions.title !== undefined && paths.length !== 1) {
        throw new CliError('bad_args', '--title needs exactly one path');
      }

      const api = apiFor(program, ctx);
      const results: Array<
        | { path: string; ok: true; resource: Resource }
        | { path: string; ok: false; error: { code: string; message: string } }
      > = [];

      for (const inputPath of paths) {
        let body: string;
        try {
          body = inputPath === '-' ? await ctx.readStdin() : fs.readFileSync(inputPath, 'utf8');
        } catch (error) {
          results.push({
            path: inputPath,
            ok: false,
            error: {
              code: 'read_failed',
              message: error instanceof Error ? error.message : String(error),
            },
          });
          continue;
        }

        const heading = firstMarkdownHeading(body);
        const title =
          commandOptions.title ??
          heading ??
          (inputPath === '-' ? undefined : path.basename(inputPath, path.extname(inputPath)));

        try {
          const created = await api.call(
            api.client.api.resources.notes.$post({
              json: {
                ...(title !== undefined ? { title } : {}),
                body,
                ...(commandOptions.tag !== undefined ? { tags: commandOptions.tag } : {}),
              },
            }),
          );
          results.push({ path: inputPath, ok: true, resource: created });
        } catch (error) {
          if (
            error instanceof CliError &&
            (error.code === 'unreachable' || error.code === 'unauthorized')
          ) {
            throw error;
          }
          results.push({
            path: inputPath,
            ok: false,
            error: {
              code: error instanceof CliError ? error.code : 'internal',
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }

      if (mode === 'json') {
        printResult(ctx, mode, results);
      } else {
        printResult(
          ctx,
          mode,
          results.map((result) => ({
            path: result.path,
            id: result.ok ? result.resource.id : '',
            title: result.ok ? result.resource.title : '',
            error: result.ok ? '' : result.error.message,
          })),
        );
      }

      const failed = results.filter((result) => !result.ok).length;
      if (failed > 0) throw new BatchFailure(failed, results.length);
    });

  add
    .command('image <path...>')
    .description('Add image files')
    .option('--title <title>')
    .option('--tag <name...>')
    .action(async (paths: string[], commandOptions: { title?: string; tag?: string[] }) => {
      const options = program.opts<GlobalOptions>();
      const mode = resolveMode(options, ctx.isTTY);
      if (commandOptions.title !== undefined && paths.length !== 1) {
        throw new CliError('bad_args', '--title needs exactly one path');
      }
      if (paths.includes('-')) {
        throw new CliError('bad_args', 'stdin (-) is not supported for images');
      }

      const api = apiFor(program, ctx);
      const results: Array<
        | { path: string; ok: true; resource: Resource }
        | { path: string; ok: false; error: { code: string; message: string } }
      > = [];

      for (const inputPath of paths) {
        let bytes: Uint8Array;
        try {
          bytes = fs.readFileSync(inputPath);
        } catch (error) {
          results.push({
            path: inputPath,
            ok: false,
            error: {
              code: 'read_failed',
              message: error instanceof Error ? error.message : String(error),
            },
          });
          continue;
        }

        try {
          const response = await api.call(
            api.client.api.resources.images.$post({
              form: {
                files: new File([bytes.slice().buffer as ArrayBuffer], path.basename(inputPath)),
                ...(commandOptions.title !== undefined ? { title: commandOptions.title } : {}),
                ...(commandOptions.tag !== undefined ? { tags: commandOptions.tag } : {}),
              },
            }),
          );
          const one = response.results[0];
          if (one?.ok) {
            results.push({ path: inputPath, ok: true, resource: one.resource });
          } else {
            results.push({
              path: inputPath,
              ok: false,
              error: one?.error ?? {
                code: 'internal',
                message: 'No result returned',
              },
            });
          }
        } catch (error) {
          if (
            error instanceof CliError &&
            (error.code === 'unreachable' || error.code === 'unauthorized')
          ) {
            throw error;
          }
          results.push({
            path: inputPath,
            ok: false,
            error: {
              code: error instanceof CliError ? error.code : 'internal',
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }

      if (mode === 'json') {
        printResult(ctx, mode, results);
      } else {
        printResult(
          ctx,
          mode,
          results.map((result) => ({
            path: result.path,
            id: result.ok ? result.resource.id : '',
            title: result.ok ? result.resource.title : '',
            error: result.ok ? '' : result.error.message,
          })),
        );
      }

      const failed = results.filter((result) => !result.ok).length;
      if (failed > 0) throw new BatchFailure(failed, results.length);
    });

  resource
    .command('list')
    .description('List resources')
    .option('--type <type>')
    .option('--search <q>')
    .option('--author <username>')
    .option('--from <date>')
    .option('--to <date>')
    .option('--sort <sort>', 'sort field', 'created')
    .option('--tag <name...>')
    .option('--desc', 'newest first')
    .option('--limit <n>', 'page size', String(RESOURCE_LIST_LIMIT_DEFAULT))
    .option('--cursor <cursor>')
    .action(
      async (commandOptions: {
        type?: string;
        search?: string;
        author?: string;
        from?: string;
        to?: string;
        sort: string;
        tag?: string[];
        desc?: boolean;
        limit: string;
        cursor?: string;
      }) => {
        if (
          commandOptions.type !== undefined &&
          !(RESOURCE_TYPES as readonly string[]).includes(commandOptions.type)
        ) {
          throw new CliError(
            'bad_value',
            `Unknown type: ${commandOptions.type}. Use tweet, image, or md`,
          );
        }
        if (commandOptions.sort !== 'created' && commandOptions.sort !== 'used') {
          throw new CliError(
            'bad_value',
            `Unknown sort: ${commandOptions.sort}. Use created or used`,
          );
        }
        for (const [name, value] of [
          ['--from', commandOptions.from],
          ['--to', commandOptions.to],
        ] as const) {
          if (value !== undefined && !isValidDate(value)) {
            throw new CliError('bad_value', `${name} must be YYYY-MM-DD`);
          }
        }
        const parsedLimit = resourceListQuerySchema.shape.limit.safeParse(commandOptions.limit);
        if (!parsedLimit.success) {
          throw new CliError(
            'usage',
            `--limit must be a whole number from 1 to ${RESOURCE_LIST_LIMIT_MAX}`,
            2,
          );
        }

        const options = program.opts<GlobalOptions>();
        const api = apiFor(program, ctx);
        const result = await api.call(
          api.client.api.resources.$get({
            query: {
              ...(commandOptions.type !== undefined
                ? { type: commandOptions.type as ResourceType }
                : {}),
              ...(commandOptions.search !== undefined ? { search: commandOptions.search } : {}),
              ...(commandOptions.author !== undefined ? { author: commandOptions.author } : {}),
              ...(commandOptions.from !== undefined ? { from: commandOptions.from } : {}),
              ...(commandOptions.to !== undefined ? { to: commandOptions.to } : {}),
              ...(commandOptions.tag !== undefined ? { tag: commandOptions.tag } : {}),
              sort: commandOptions.sort as 'created' | 'used',
              order: commandOptions.desc ? 'desc' : 'asc',
              limit: String(parsedLimit.data),
              ...(commandOptions.cursor !== undefined ? { cursor: commandOptions.cursor } : {}),
            },
          }),
        );
        const mode = resolveMode(options, ctx.isTTY);
        if (mode === 'json') {
          printResult(ctx, mode, result);
          return;
        }

        const rows = result.items.map((item) => ({
          id: item.id,
          type: item.type,
          title: item.title,
          created: item.created_at,
          author: item.type === 'tweet' ? `@${item.author_username}` : '',
          tags: item.tags.join(', '),
        }));
        const summary = `${result.items.length} shown · ${result.total} total`;
        if (rows.length === 0) {
          ctx.stdout.write(`${summary}\n`);
          return;
        }

        ctx.stdout.write(`${formatTable(rows)}\n\n${summary}\n`);
        if (result.next_cursor !== null) {
          ctx.stdout.write(`next: --cursor ${result.next_cursor}\n`);
        }
      },
    );

  resource
    .command('show <id>')
    .description('Show a resource')
    .action(async (idValue: string) => {
      const id = positiveId(idValue);
      const api = apiFor(program, ctx);
      const found = await api.call(
        api.client.api.resources[':id'].$get({ param: { id: String(id) } }),
      );
      printResource(ctx, program.opts<GlobalOptions>(), found);
    });

  resource
    .command('edit <id>')
    .description('Edit a resource')
    .option('--title <title>')
    .option('--notes <notes>')
    .option('--content <path>')
    .option('-e, --editor')
    .action(
      async (
        idValue: string,
        commandOptions: {
          title?: string;
          notes?: string;
          content?: string;
          editor?: boolean;
        },
      ) => {
        const id = positiveId(idValue);
        if (commandOptions.content !== undefined && commandOptions.editor) {
          throw new CliError('bad_args', 'Use either --content or -e, not both');
        }
        if (
          commandOptions.title === undefined &&
          commandOptions.notes === undefined &&
          commandOptions.content === undefined &&
          !commandOptions.editor
        ) {
          throw new CliError(
            'bad_args',
            'Nothing to update: pass --title, --notes, --content, or -e',
          );
        }
        if (commandOptions.title !== undefined && commandOptions.title.trim() === '') {
          throw new CliError('bad_value', '--title must not be empty');
        }
        if (commandOptions.editor && (!ctx.isTTY || !ctx.stdinIsTTY)) {
          throw new CliError('no_tty', '-e needs a terminal');
        }

        const api = apiFor(program, ctx);
        const patch: ResourcePatch = {
          ...(commandOptions.title !== undefined ? { title: commandOptions.title } : {}),
          ...(commandOptions.notes !== undefined ? { notes: commandOptions.notes } : {}),
        };
        let current: Resource | undefined;

        if (commandOptions.content !== undefined) {
          patch.body =
            commandOptions.content === '-'
              ? await ctx.readStdin()
              : fs.readFileSync(commandOptions.content, 'utf8');
        } else if (commandOptions.editor) {
          current = await api.call(
            api.client.api.resources[':id'].$get({ param: { id: String(id) } }),
          );
          if (current.type !== 'md') {
            throw new CliError('bad_args', 'Only notes have a body');
          }
          patch.body = await ctx.editText(current.body);
          if (
            patch.body === current.body &&
            commandOptions.title === undefined &&
            commandOptions.notes === undefined
          ) {
            printResource(ctx, program.opts<GlobalOptions>(), current);
            return;
          }
        }

        const updated = await api.call(
          api.client.api.resources[':id'].$patch({
            param: { id: String(id) },
            json: patch,
          }),
        );
        printResource(ctx, program.opts<GlobalOptions>(), updated);
      },
    );

  resource
    .command('delete <id...>')
    .description('Delete resources')
    .action(async (idValues: string[]) => {
      const ids = idValues.map((value) => positiveId(value, true));
      const options = program.opts<GlobalOptions>();

      if (!options.yes) {
        if (!ctx.isTTY || !ctx.stdinIsTTY) {
          throw new CliError('confirm_required', 'Refusing to delete without --yes');
        }
        const confirmed = await ctx.confirm(
          `Delete ${ids.length} resource${ids.length === 1 ? '' : 's'} (${ids.join(', ')})?`,
        );
        if (!confirmed) {
          ctx.stderr.write('Cancelled\n');
          return;
        }
      }

      const api = apiFor(program, ctx);
      const response = await api.call(api.client.api.resources.$delete({ json: { ids } }));
      const mode = resolveMode(options, ctx.isTTY);
      if (mode === 'json') {
        printResult(ctx, mode, response.results);
      } else {
        printResult(
          ctx,
          mode,
          response.results.map((result) => ({
            id: result.id,
            ok: result.ok,
            unlinked_posts: result.ok ? result.unlinked_post_ids.join(', ') : '',
            error: result.ok ? '' : result.error.message,
          })),
        );
      }

      const failed = response.results.filter((result) => !result.ok).length;
      if (failed > 0) throw new BatchFailure(failed, response.results.length);
    });

  resource
    .command('tag <id...>')
    .description('Add or remove tags on resources')
    .option('--add <name...>')
    .option('--remove <name...>')
    .action(async (idValues: string[], commandOptions: { add?: string[]; remove?: string[] }) => {
      const ids = idValues.map((value) => positiveId(value, true));
      if (commandOptions.add === undefined && commandOptions.remove === undefined) {
        throw new CliError('usage', 'Give --add or --remove', 2);
      }

      const api = apiFor(program, ctx);
      let results: ItemTagsResponse['results'] = [];
      if (commandOptions.add !== undefined) {
        results = (
          await api.call(
            api.client.api.resources.tags.$post({
              json: { ids, tags: commandOptions.add },
            }),
          )
        ).results;
      }
      if (commandOptions.remove !== undefined) {
        results = (
          await api.call(
            api.client.api.resources.tags.$delete({
              json: { ids, tags: commandOptions.remove },
            }),
          )
        ).results;
      }

      const mode = resolveMode(program.opts<GlobalOptions>(), ctx.isTTY);
      if (mode === 'json') {
        printResult(ctx, mode, results);
      } else {
        printResult(
          ctx,
          mode,
          results.map((result) => ({
            id: result.id,
            ok: result.ok,
            tags: result.ok ? result.tags.join(', ') : '',
            error: result.ok ? '' : result.error.message,
          })),
        );
      }
      const failed = results.filter((result) => !result.ok).length;
      if (failed > 0) throw new BatchFailure(failed, results.length);
    });

  resource
    .command('pull')
    .description('Copy every Resource into the Mirror')
    .option('--dir <path>')
    .action(async (commandOptions: { dir?: string }) => {
      const options = program.opts<GlobalOptions>();
      const mode = resolveMode(options, ctx.isTTY);
      const serverUrl = resolveServerUrl(ctx, options.server);
      const dir = resolveMirrorDir(ctx, commandOptions.dir);
      const api = apiFor(program, ctx);
      const text = await api.callText(api.client.api.resources.export.$get());
      const resources: Resource[] = [];
      for (const line of text.split('\n')) {
        if (line === '') continue;
        try {
          resources.push(resourceSchema.parse(JSON.parse(line)));
        } catch {
          throw new CliError('bad_response', `Server at ${serverUrl} sent an invalid export line`);
        }
      }
      const result = applyMirror(dir, resources, ctx.now());
      printResult(ctx, mode, {
        dir,
        added: result.added,
        updated: result.updated,
        removed: result.removed,
        pulled_at: result.pulled_at,
      });
    });
}
