import fs from 'node:fs';
import path from 'node:path';

import {
  formatCost,
  type ItemTagsResponse,
  POST_LIST_LIMIT_DEFAULT,
  POST_STATUSES,
  type Post,
  type PostPatch,
  type PostPreview,
  type PostStatus,
  type PostStatusResponse,
} from '@perch/core';
import type { Command } from 'commander';

import { createApi } from '../api';
import { resolveServerUrl, resolveToken } from '../config';
import type { CliContext } from '../context';
import {
  BatchFailure,
  CliError,
  formatTable,
  mergeItemTagResults,
  printResult,
  resolveMode,
} from '../output';

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

function printPost(ctx: CliContext, options: GlobalOptions, post: Post): void {
  const mode = resolveMode(options, ctx.isTTY);
  if (mode === 'json') {
    printResult(ctx, mode, post);
    return;
  }

  ctx.stdout.write(
    `${formatTable({
      id: post.id,
      status: post.status,
      title: post.title,
      characters: `${post.character_count} / ${post.limit}`,
      cost: formatCost(post.estimated_cost),
      scheduled: post.scheduled_at ?? '',
      published: post.published_at ?? '',
      links: post.links.map((link) => link.resource_id).join(', '),
      tags: post.tags.join(', '),
      media: post.media.map((item) => item.position).join(', '),
      ready: post.ready.checks
        .map((check) => `${check.ok ? 'ok' : 'no'} ${check.label}`)
        .join('; '),
      created: post.created_at,
      updated: post.updated_at,
    })}\n\n${post.text}\n`,
  );
}

function wordWrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    let current = '';
    for (const word of rawLine.split(' ')) {
      const rest = current === '' ? word : `${current} ${word}`;
      if (rest.length <= width) {
        current = rest;
        continue;
      }
      if (current !== '') lines.push(current);
      let piece = word;
      while (piece.length > width) {
        lines.push(piece.slice(0, width));
        piece = piece.slice(width);
      }
      current = piece;
    }
    lines.push(current);
  }
  return lines;
}

function printPreviewCard(ctx: CliContext, preview: PostPreview, text: string): void {
  const lines = text === '' ? ['Nothing yet.'] : text.split('\n').flatMap((l) => wordWrap(l, 56));
  const border = `+${'-'.repeat(58)}+`;
  ctx.stdout.write(
    `${border}\n${lines.map((line) => `| ${line.padEnd(56)} |`).join('\n')}\n${border}\n` +
      `Characters: ${preview.character_count} / ${preview.limit}\n` +
      `Cost: ${formatCost(preview.estimated_cost)}\n`,
  );
}

async function readTextInput(
  ctx: CliContext,
  commandOptions: { text?: string; file?: string },
  stdinArg: string | undefined,
): Promise<string> {
  const given = [
    commandOptions.text !== undefined,
    commandOptions.file !== undefined,
    stdinArg !== undefined,
  ].filter(Boolean).length;
  if (given > 1 || (stdinArg !== undefined && stdinArg !== '-')) {
    throw new CliError('bad_args', 'Use one of --text, --file, or -');
  }
  if (commandOptions.text !== undefined) return commandOptions.text;
  if (commandOptions.file !== undefined) {
    return fs.readFileSync(commandOptions.file, 'utf8');
  }
  if (stdinArg === '-') return ctx.readStdin();
  return '';
}

export function addPostCommands(program: Command, ctx: CliContext): void {
  const post = program.command('post').description('Manage posts');

  post
    .command('create [stdin]')
    .description('Create a post')
    .option('--title <title>')
    .option('--text <text>')
    .option('--file <path>')
    .option('--from <rid...>')
    .option('--tag <name...>')
    .option('--official')
    .action(
      async (
        stdinArg: string | undefined,
        commandOptions: {
          title?: string;
          text?: string;
          file?: string;
          from?: string[];
          tag?: string[];
          official?: boolean;
        },
      ) => {
        const text = await readTextInput(ctx, commandOptions, stdinArg);
        const from = (commandOptions.from ?? []).map((value) => positiveId(value, true));

        const api = apiFor(program, ctx);
        const created = await api.call(
          api.client.api.posts.$post({
            json: {
              ...(commandOptions.title !== undefined ? { title: commandOptions.title } : {}),
              text,
              ...(from.length > 0 ? { from } : {}),
              ...(commandOptions.tag !== undefined ? { tags: commandOptions.tag } : {}),
              ...(commandOptions.official === true ? { official: true } : {}),
            },
          }),
        );
        printPost(ctx, program.opts<GlobalOptions>(), created);
      },
    );

  post
    .command('list')
    .description('List posts')
    .option('--status <status>')
    .option('--search <q>')
    .option('--from <d>')
    .option('--to <d>')
    .option('--tag <name...>')
    .option('--limit <n>', 'page size', String(POST_LIST_LIMIT_DEFAULT))
    .option('--cursor <cursor>')
    .option('--scheduled')
    .option('--unscheduled')
    .action(
      async (commandOptions: {
        status?: string;
        search?: string;
        from?: string;
        to?: string;
        tag?: string[];
        limit: string;
        cursor?: string;
        scheduled?: boolean;
        unscheduled?: boolean;
      }) => {
        if (commandOptions.scheduled === true && commandOptions.unscheduled === true) {
          throw new CliError('bad_args', 'Use one of --scheduled or --unscheduled');
        }
        if (
          commandOptions.status !== undefined &&
          !(POST_STATUSES as readonly string[]).includes(commandOptions.status)
        ) {
          throw new CliError(
            'bad_value',
            `Unknown status: ${commandOptions.status}. Use ${POST_STATUSES.join(', ')}`,
          );
        }
        for (const [flag, value] of [
          ['--from', commandOptions.from],
          ['--to', commandOptions.to],
        ] as const) {
          if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            throw new CliError('bad_value', `${flag} must be YYYY-MM-DD`);
          }
        }
        if (!/^\d+$/.test(commandOptions.limit) || Number(commandOptions.limit) <= 0) {
          throw new CliError('bad_value', '--limit must be a positive integer');
        }

        const options = program.opts<GlobalOptions>();
        const api = apiFor(program, ctx);
        const result = await api.call(
          api.client.api.posts.$get({
            query: {
              ...(commandOptions.status !== undefined
                ? { status: commandOptions.status as PostStatus }
                : {}),
              ...(commandOptions.search !== undefined ? { search: commandOptions.search } : {}),
              ...(commandOptions.from !== undefined ? { from: commandOptions.from } : {}),
              ...(commandOptions.to !== undefined ? { to: commandOptions.to } : {}),
              ...(commandOptions.tag !== undefined ? { tag: commandOptions.tag } : {}),
              ...(commandOptions.scheduled === true ? { scheduled: 'true' as const } : {}),
              ...(commandOptions.unscheduled === true ? { scheduled: 'false' as const } : {}),
              limit: String(Number(commandOptions.limit)),
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
          status: item.status,
          when: item.scheduled_at ?? item.published_at ?? '',
          title: item.title,
          chars: `${item.character_count} / ${item.limit}`,
          cost: formatCost(item.estimated_cost),
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

  post
    .command('show <id>')
    .description('Show a post')
    .action(async (idValue: string) => {
      const id = positiveId(idValue);
      const api = apiFor(program, ctx);
      const found = await api.call(api.client.api.posts[':id'].$get({ param: { id: String(id) } }));
      printPost(ctx, program.opts<GlobalOptions>(), found);
    });

  post
    .command('preview <id>')
    .description('Preview a post as it looks on X')
    .action(async (idValue: string) => {
      const id = positiveId(idValue);
      const options = program.opts<GlobalOptions>();
      const mode = resolveMode(options, ctx.isTTY);
      const api = apiFor(program, ctx);
      const preview = await api.call(
        api.client.api.posts[':id'].preview.$get({ param: { id: String(id) } }),
      );
      if (mode === 'json') {
        printResult(ctx, mode, preview);
        return;
      }
      const found = await api.call(api.client.api.posts[':id'].$get({ param: { id: String(id) } }));
      printPreviewCard(ctx, preview, found.text);
    });

  post
    .command('edit <id> [stdin]')
    .description('Edit a post')
    .option('--title <title>')
    .option('--text <text>')
    .option('--file <path>')
    .option('-e, --editor')
    .action(
      async (
        idValue: string,
        stdinArg: string | undefined,
        commandOptions: {
          title?: string;
          text?: string;
          file?: string;
          editor?: boolean;
        },
      ) => {
        const id = positiveId(idValue);

        const textSources = [
          commandOptions.text !== undefined,
          commandOptions.file !== undefined,
          stdinArg !== undefined,
          commandOptions.editor === true,
        ].filter(Boolean).length;
        if (textSources > 1) {
          throw new CliError('bad_args', 'Use one of --text, --file, -, or -e');
        }
        if (commandOptions.title === undefined && textSources === 0) {
          throw new CliError(
            'bad_args',
            'Nothing to update: pass --title, --text, --file, -, or -e',
          );
        }
        if (commandOptions.editor && (!ctx.isTTY || !ctx.stdinIsTTY)) {
          throw new CliError('no_tty', '-e needs a terminal');
        }

        const api = apiFor(program, ctx);
        const patch: PostPatch = {
          ...(commandOptions.title !== undefined ? { title: commandOptions.title } : {}),
        };
        let current: Post | undefined;

        if (commandOptions.editor) {
          current = await api.call(api.client.api.posts[':id'].$get({ param: { id: String(id) } }));
          patch.text = await ctx.editText(current.text);
        } else {
          const text = await readTextInput(ctx, commandOptions, stdinArg);
          if (
            commandOptions.text !== undefined ||
            commandOptions.file !== undefined ||
            stdinArg !== undefined
          ) {
            patch.text = text;
          }
        }

        const updated = await api.call(
          api.client.api.posts[':id'].$patch({
            param: { id: String(id) },
            json: patch,
          }),
        );
        printPost(ctx, program.opts<GlobalOptions>(), updated);
      },
    );

  post
    .command('link <id>')
    .description('Link resources to a post')
    .requiredOption('--resource <rid...>')
    .action(async (idValue: string, commandOptions: { resource: string[] }) => {
      const id = positiveId(idValue);
      const ids = commandOptions.resource.map((value) => positiveId(value, true));
      const api = apiFor(program, ctx);
      const response = await api.call(
        api.client.api.posts[':id'].links.$post({
          param: { id: String(id) },
          json: { resource_ids: ids },
        }),
      );
      printResult(ctx, resolveMode(program.opts<GlobalOptions>(), ctx.isTTY), response.results);
      const failed = response.results.filter((result) => !result.ok).length;
      if (failed > 0) throw new BatchFailure(failed, response.results.length);
    });

  post
    .command('unlink <id>')
    .description('Unlink resources from a post')
    .requiredOption('--resource <rid...>')
    .action(async (idValue: string, commandOptions: { resource: string[] }) => {
      const id = positiveId(idValue);
      const ids = commandOptions.resource.map((value) => positiveId(value, true));
      const api = apiFor(program, ctx);
      const response = await api.call(
        api.client.api.posts[':id'].links.$delete({
          param: { id: String(id) },
          json: { resource_ids: ids },
        }),
      );
      printResult(ctx, resolveMode(program.opts<GlobalOptions>(), ctx.isTTY), response.results);
      const failed = response.results.filter((result) => !result.ok).length;
      if (failed > 0) throw new BatchFailure(failed, response.results.length);
    });

  post
    .command('tag <id...>')
    .description('Add or remove tags on posts')
    .option('--add <name...>')
    .option('--remove <name...>')
    .action(async (idValues: string[], commandOptions: { add?: string[]; remove?: string[] }) => {
      const ids = idValues.map((value) => positiveId(value, true));
      if (commandOptions.add === undefined && commandOptions.remove === undefined) {
        throw new CliError('usage', 'Give --add or --remove', 2);
      }

      const api = apiFor(program, ctx);
      const batches: ItemTagsResponse['results'][] = [];
      if (commandOptions.add !== undefined) {
        batches.push(
          (
            await api.call(
              api.client.api.posts.tags.$post({
                json: { ids, tags: commandOptions.add },
              }),
            )
          ).results,
        );
      }
      if (commandOptions.remove !== undefined) {
        batches.push(
          (
            await api.call(
              api.client.api.posts.tags.$delete({
                json: { ids, tags: commandOptions.remove },
              }),
            )
          ).results,
        );
      }
      const merged = mergeItemTagResults(...batches);

      const mode = resolveMode(program.opts<GlobalOptions>(), ctx.isTTY);
      if (mode === 'json') {
        printResult(ctx, mode, merged);
      } else {
        printResult(
          ctx,
          mode,
          merged.map((result) => ({
            id: result.id,
            ok: result.ok,
            tags: result.ok ? result.tags.join(', ') : '',
            error: result.ok ? '' : result.error.message,
          })),
        );
      }
      const failed = merged.filter((result) => !result.ok).length;
      if (failed > 0) throw new BatchFailure(failed, merged.length);
    });

  post
    .command('attach <id>')
    .description('Attach media to a post')
    .option('--resource <rid...>')
    .option('--file <path...>')
    .action(async (idValue: string, commandOptions: { resource?: string[]; file?: string[] }) => {
      const id = positiveId(idValue);
      const mode = resolveMode(program.opts<GlobalOptions>(), ctx.isTTY);
      const resourceIds = (commandOptions.resource ?? []).map((value) => positiveId(value, true));
      const files = commandOptions.file ?? [];
      if (resourceIds.length === 0 && files.length === 0) {
        throw new CliError('bad_args', 'Use --resource or --file');
      }

      const api = apiFor(program, ctx);
      const results: Array<{
        name?: string;
        id?: number;
        ok: boolean;
        error?: { code: string; message: string };
      }> = [];
      if (resourceIds.length > 0) {
        const response = await api.call(
          api.client.api.posts[':id'].media.$post({
            param: { id: String(id) },
            json: { resource_ids: resourceIds },
          }),
        );
        results.push(...response.results);
      }
      if (files.length > 0) {
        const readable: File[] = [];
        for (const filePath of files) {
          const name = path.basename(filePath);
          try {
            readable.push(
              new File([fs.readFileSync(filePath).slice().buffer as ArrayBuffer], name),
            );
          } catch (error) {
            results.push({
              name,
              ok: false,
              error: {
                code: 'read_failed',
                message: error instanceof Error ? error.message : 'Cannot read file',
              },
            });
          }
        }
        if (readable.length > 0) {
          const response = await api.call(
            api.client.api.posts[':id'].media.files.$post({
              param: { id: String(id) },
              form: { files: readable },
            }),
          );
          results.push(...response.results);
        }
      }

      printResult(ctx, mode, results);
      const failed = results.filter((result) => !result.ok).length;
      if (failed > 0) throw new BatchFailure(failed, results.length);
    });

  post
    .command('detach <id>')
    .description('Detach media from a post')
    .option('--media <n...>')
    .option('--all')
    .action(async (idValue: string, commandOptions: { media?: string[]; all?: boolean }) => {
      const id = positiveId(idValue);
      const positions = (commandOptions.media ?? []).map((value) => positiveId(value, true));
      if (positions.length > 0 === (commandOptions.all === true)) {
        throw new CliError('bad_args', 'Use one of --media or --all');
      }

      const api = apiFor(program, ctx);
      const response = await api.call(
        api.client.api.posts[':id'].media.$delete({
          param: { id: String(id) },
          json: commandOptions.all ? { all: true } : { positions },
        }),
      );
      printResult(ctx, resolveMode(program.opts<GlobalOptions>(), ctx.isTTY), response.media);
    });

  const statusPrint = (
    results: PostStatusResponse['results'],
    mode: ReturnType<typeof resolveMode>,
  ): void => {
    if (mode === 'json') {
      printResult(ctx, mode, results);
      return;
    }
    printResult(
      ctx,
      mode,
      results.map((result) => ({
        id: result.id,
        ok: result.ok,
        error: result.ok
          ? ''
          : result.error.message +
            (result.error.errors !== undefined
              ? `: ${result.error.errors.map((e) => e.message).join('; ')}`
              : ''),
      })),
    );
  };

  post
    .command('promote <id...>')
    .description('Promote drafts to official')
    .action(async (idValues: string[]) => {
      const ids = idValues.map((value) => positiveId(value, true));
      const api = apiFor(program, ctx);
      const response = await api.call(api.client.api.posts.promote.$post({ json: { ids } }));
      statusPrint(response.results, resolveMode(program.opts<GlobalOptions>(), ctx.isTTY));
      const failed = response.results.filter((result) => !result.ok).length;
      if (failed > 0) throw new BatchFailure(failed, response.results.length);
    });

  post
    .command('demote <id...>')
    .description('Demote official or failed posts to draft')
    .action(async (idValues: string[]) => {
      const ids = idValues.map((value) => positiveId(value, true));
      const api = apiFor(program, ctx);
      const response = await api.call(api.client.api.posts.demote.$post({ json: { ids } }));
      statusPrint(response.results, resolveMode(program.opts<GlobalOptions>(), ctx.isTTY));
      const failed = response.results.filter((result) => !result.ok).length;
      if (failed > 0) throw new BatchFailure(failed, response.results.length);
    });

  post
    .command('unschedule <id...>')
    .description('Clear the schedule on posts')
    .action(async (idValues: string[]) => {
      const ids = idValues.map((value) => positiveId(value, true));
      const api = apiFor(program, ctx);
      const response = await api.call(api.client.api.posts.unschedule.$post({ json: { ids } }));
      statusPrint(response.results, resolveMode(program.opts<GlobalOptions>(), ctx.isTTY));
      const failed = response.results.filter((result) => !result.ok).length;
      if (failed > 0) throw new BatchFailure(failed, response.results.length);
    });

  post
    .command('schedule <id>')
    .description('Set the schedule time on a post')
    .requiredOption('--at <time>')
    .option('--force')
    .action(async (idValue: string, commandOptions: { at: string; force?: boolean }) => {
      const id = positiveId(idValue);
      const api = apiFor(program, ctx);
      const post = await api.call(
        api.client.api.posts[':id'].schedule.$post({
          param: { id: String(id) },
          json: { at: commandOptions.at, ...(commandOptions.force ? { force: true } : {}) },
        }),
      );
      printPost(ctx, program.opts<GlobalOptions>(), post);
    });

  post
    .command('delete <id...>')
    .description('Delete posts')
    .action(async (idValues: string[]) => {
      const ids = idValues.map((value) => positiveId(value, true));
      const options = program.opts<GlobalOptions>();

      if (!options.yes) {
        if (!ctx.isTTY || !ctx.stdinIsTTY) {
          throw new CliError('confirm_required', 'Refusing to delete without --yes');
        }
        const confirmed = await ctx.confirm(
          `Delete ${ids.length} post${ids.length === 1 ? '' : 's'} (${ids.join(', ')})?`,
        );
        if (!confirmed) {
          ctx.stderr.write('Cancelled\n');
          return;
        }
      }

      const api = apiFor(program, ctx);
      const response = await api.call(api.client.api.posts.$delete({ json: { ids } }));
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
            error: result.ok ? '' : result.error.message,
          })),
        );
      }

      const failed = response.results.filter((result) => !result.ok).length;
      if (failed > 0) throw new BatchFailure(failed, response.results.length);
    });
}
