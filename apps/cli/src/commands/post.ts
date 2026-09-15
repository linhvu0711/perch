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

import { type CommandResult, mergeItemTagResults, positiveId, run } from '../cli';
import type { CliContext } from '../context';
import { CliError, formatTable, UsageError } from '../output';

function postResult(post: Post): CommandResult {
  return {
    value: post,
    table: `${formatTable({
      id: post.id,
      status: post.status,
      title: post.title,
      characters: `${post.character_count} / ${post.limit}`,
      cost: formatCost(post.estimated_cost),
      scheduled: post.scheduled_at ?? '',
      missed: post.missed ? 'yes' : '',
      published: post.published_at ?? '',
      x_url: post.x_post_url ?? '',
      links: post.links.map((link) => link.resource_id).join(', '),
      tags: post.tags.join(', '),
      media: post.media.map((item) => item.position).join(', '),
      ready: post.ready.checks
        .map((check) => `${check.ok ? 'ok' : 'no'} ${check.label}`)
        .join('; '),
      created: post.created_at,
      updated: post.updated_at,
    })}\n\n${post.text}`,
  };
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

function previewCard(preview: PostPreview, text: string): string {
  const lines = text === '' ? ['Nothing yet.'] : text.split('\n').flatMap((l) => wordWrap(l, 56));
  const border = `+${'-'.repeat(58)}+`;
  return (
    `${border}\n${lines.map((line) => `| ${line.padEnd(56)} |`).join('\n')}\n${border}\n` +
    `Characters: ${preview.character_count} / ${preview.limit}\n` +
    `Cost: ${formatCost(preview.estimated_cost)}`
  );
}

function statusRows(results: PostStatusResponse['results']): Array<{
  id: number;
  ok: boolean;
  error: string;
}> {
  return results.map((result) => ({
    id: result.id,
    ok: result.ok,
    error: result.ok
      ? ''
      : result.error.message +
        (result.error.errors !== undefined
          ? `: ${result.error.errors.map((e) => e.message).join('; ')}`
          : ''),
  }));
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
    throw new UsageError('bad_args', 'Use one of --text, --file, or -');
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
      run(
        ctx,
        async (
          { api },
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
          return postResult(created);
        },
      ),
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
    .option('--missed')
    .option('--needs-attention')
    .action(
      run(
        ctx,
        async (
          { api },
          commandOptions: {
            status?: string;
            search?: string;
            from?: string;
            to?: string;
            tag?: string[];
            limit: string;
            cursor?: string;
            scheduled?: boolean;
            unscheduled?: boolean;
            missed?: boolean;
            needsAttention?: boolean;
          },
        ) => {
          if (commandOptions.scheduled === true && commandOptions.unscheduled === true) {
            throw new UsageError('bad_args', 'Use one of --scheduled or --unscheduled');
          }
          if (
            commandOptions.status !== undefined &&
            !(POST_STATUSES as readonly string[]).includes(commandOptions.status)
          ) {
            throw new UsageError(
              'bad_value',
              `Unknown status: ${commandOptions.status}. Use ${POST_STATUSES.join(', ')}`,
            );
          }
          for (const [flag, value] of [
            ['--from', commandOptions.from],
            ['--to', commandOptions.to],
          ] as const) {
            if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
              throw new UsageError('bad_value', `${flag} must be YYYY-MM-DD`);
            }
          }
          if (!/^\d+$/.test(commandOptions.limit) || Number(commandOptions.limit) <= 0) {
            throw new UsageError('bad_value', '--limit must be a positive integer');
          }

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
                ...(commandOptions.missed === true ? { missed: 'true' as const } : {}),
                ...(commandOptions.needsAttention === true
                  ? { needs_attention: 'true' as const }
                  : {}),
                limit: String(Number(commandOptions.limit)),
                ...(commandOptions.cursor !== undefined ? { cursor: commandOptions.cursor } : {}),
              },
            }),
          );

          const rows = result.items.map((item) => ({
            id: item.id,
            status: item.missed ? 'missed' : item.status,
            reason: item.reason ?? '',
            when: item.scheduled_at ?? item.published_at ?? '',
            title: item.title,
            chars: `${item.character_count} / ${item.limit}`,
            cost: formatCost(item.estimated_cost),
            tags: item.tags.join(', '),
          }));
          const summary = `${result.items.length} shown · ${result.total} total`;

          return {
            value: result,
            table:
              rows.length === 0
                ? summary
                : `${formatTable(rows)}\n\n${summary}${result.next_cursor !== null ? `\nnext: --cursor ${result.next_cursor}` : ''}`,
          };
        },
      ),
    );

  post
    .command('show <id>')
    .description('Show a post')
    .action(
      run(ctx, async ({ api }, idValue: string) => {
        const id = positiveId(idValue);
        const found = await api.call(
          api.client.api.posts[':id'].$get({ param: { id: String(id) } }),
        );
        return postResult(found);
      }),
    );

  post
    .command('preview <id>')
    .description('Preview a post as it looks on X')
    .action(
      run(ctx, async ({ api, mode }, idValue: string) => {
        const id = positiveId(idValue);
        const preview = await api.call(
          api.client.api.posts[':id'].preview.$get({ param: { id: String(id) } }),
        );
        if (mode === 'json') return { value: preview };
        const found = await api.call(
          api.client.api.posts[':id'].$get({ param: { id: String(id) } }),
        );
        return { value: preview, table: previewCard(preview, found.text) };
      }),
    );

  post
    .command('edit <id> [stdin]')
    .description('Edit a post')
    .option('--title <title>')
    .option('--text <text>')
    .option('--file <path>')
    .option('-e, --editor')
    .action(
      run(
        ctx,
        async (
          { api },
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
            throw new UsageError('bad_args', 'Use one of --text, --file, -, or -e');
          }
          if (commandOptions.title === undefined && textSources === 0) {
            throw new UsageError(
              'bad_args',
              'Nothing to update: pass --title, --text, --file, -, or -e',
            );
          }
          if (commandOptions.editor && (!ctx.isTTY || !ctx.stdinIsTTY)) {
            throw new CliError('no_tty', '-e needs a terminal');
          }

          const patch: PostPatch = {
            ...(commandOptions.title !== undefined ? { title: commandOptions.title } : {}),
          };

          if (commandOptions.editor) {
            const current = await api.call(
              api.client.api.posts[':id'].$get({ param: { id: String(id) } }),
            );
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
          return postResult(updated);
        },
      ),
    );

  post
    .command('link <id>')
    .description('Link resources to a post')
    .requiredOption('--resource <rid...>')
    .action(
      run(ctx, async ({ api }, idValue: string, commandOptions: { resource: string[] }) => {
        const id = positiveId(idValue);
        const ids = commandOptions.resource.map((value) => positiveId(value, true));
        const response = await api.call(
          api.client.api.posts[':id'].links.$post({
            param: { id: String(id) },
            json: { resource_ids: ids },
          }),
        );
        return { batch: response.results };
      }),
    );

  post
    .command('unlink <id>')
    .description('Unlink resources from a post')
    .requiredOption('--resource <rid...>')
    .action(
      run(ctx, async ({ api }, idValue: string, commandOptions: { resource: string[] }) => {
        const id = positiveId(idValue);
        const ids = commandOptions.resource.map((value) => positiveId(value, true));
        const response = await api.call(
          api.client.api.posts[':id'].links.$delete({
            param: { id: String(id) },
            json: { resource_ids: ids },
          }),
        );
        return { batch: response.results };
      }),
    );

  post
    .command('tag <id...>')
    .description('Add or remove tags on posts')
    .option('--add <name...>')
    .option('--remove <name...>')
    .action(
      run(
        ctx,
        async (
          { api },
          idValues: string[],
          commandOptions: { add?: string[]; remove?: string[] },
        ) => {
          const ids = idValues.map((value) => positiveId(value, true));
          if (commandOptions.add === undefined && commandOptions.remove === undefined) {
            throw new UsageError('usage', 'Give --add or --remove');
          }

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

          return {
            batch: merged,
            table: merged.map((result) => ({
              id: result.id,
              ok: result.ok,
              tags: result.ok ? result.tags.join(', ') : '',
              error: result.ok ? '' : result.error.message,
            })),
          };
        },
      ),
    );

  post
    .command('attach <id>')
    .description('Attach media to a post')
    .option('--resource <rid...>')
    .option('--file <path...>')
    .action(
      run(
        ctx,
        async (
          { api },
          idValue: string,
          commandOptions: { resource?: string[]; file?: string[] },
        ) => {
          const id = positiveId(idValue);
          const resourceIds = (commandOptions.resource ?? []).map((value) =>
            positiveId(value, true),
          );
          const files = commandOptions.file ?? [];
          if (resourceIds.length === 0 && files.length === 0) {
            throw new UsageError('bad_args', 'Use --resource or --file');
          }

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

          return { batch: results };
        },
      ),
    );

  post
    .command('detach <id>')
    .description('Detach media from a post')
    .option('--media <n...>')
    .option('--all')
    .action(
      run(
        ctx,
        async ({ api }, idValue: string, commandOptions: { media?: string[]; all?: boolean }) => {
          const id = positiveId(idValue);
          const positions = (commandOptions.media ?? []).map((value) => positiveId(value, true));
          if (positions.length > 0 === (commandOptions.all === true)) {
            throw new UsageError('bad_args', 'Use one of --media or --all');
          }

          const response = await api.call(
            api.client.api.posts[':id'].media.$delete({
              param: { id: String(id) },
              json: commandOptions.all ? { all: true } : { positions },
            }),
          );
          return postResult(response);
        },
      ),
    );

  post
    .command('promote <id...>')
    .description('Promote drafts to official')
    .action(
      run(ctx, async ({ api }, idValues: string[]) => {
        const ids = idValues.map((value) => positiveId(value, true));
        const response = await api.call(api.client.api.posts.promote.$post({ json: { ids } }));
        return { batch: response.results, table: statusRows(response.results) };
      }),
    );

  post
    .command('demote <id...>')
    .description('Demote official or failed posts to draft')
    .action(
      run(ctx, async ({ api }, idValues: string[]) => {
        const ids = idValues.map((value) => positiveId(value, true));
        const response = await api.call(api.client.api.posts.demote.$post({ json: { ids } }));
        return { batch: response.results, table: statusRows(response.results) };
      }),
    );

  post
    .command('unschedule <id...>')
    .description('Clear the schedule on posts')
    .action(
      run(ctx, async ({ api }, idValues: string[]) => {
        const ids = idValues.map((value) => positiveId(value, true));
        const response = await api.call(api.client.api.posts.unschedule.$post({ json: { ids } }));
        return { batch: response.results, table: statusRows(response.results) };
      }),
    );

  post
    .command('schedule <id>')
    .description('Set the schedule time on a post')
    .requiredOption('--at <time>')
    .option('--force')
    .action(
      run(
        ctx,
        async ({ api }, idValue: string, commandOptions: { at: string; force?: boolean }) => {
          const id = positiveId(idValue);
          const updated = await api.call(
            api.client.api.posts[':id'].schedule.$post({
              param: { id: String(id) },
              json: { at: commandOptions.at, ...(commandOptions.force ? { force: true } : {}) },
            }),
          );
          return postResult(updated);
        },
      ),
    );

  post
    .command('publish <id>')
    .description('Publish a post now')
    .action(
      run(ctx, async ({ api }, idValue: string) => {
        const id = positiveId(idValue);
        const updated = await api.call(
          api.client.api.posts[':id'].publish.$post({ param: { id: String(id) } }),
        );
        return postResult(updated);
      }),
    );

  post
    .command('retry <id>')
    .description('Retry a failed post now')
    .action(
      run(ctx, async ({ api }, idValue: string) => {
        const id = positiveId(idValue);
        const updated = await api.call(
          api.client.api.posts[':id'].retry.$post({ param: { id: String(id) } }),
        );
        return postResult(updated);
      }),
    );

  post
    .command('delete <id...>')
    .description('Delete posts')
    .action(
      run(ctx, async ({ api, confirmOrRefuse }, idValues: string[]) => {
        const ids = idValues.map((value) => positiveId(value, true));

        if (
          !(await confirmOrRefuse(
            `Delete ${ids.length} post${ids.length === 1 ? '' : 's'} (${ids.join(', ')})?`,
            'Refusing to delete without --yes',
          ))
        ) {
          return undefined;
        }

        const response = await api.call(api.client.api.posts.$delete({ json: { ids } }));
        return {
          batch: response.results,
          table: response.results.map((result) => ({
            id: result.id,
            ok: result.ok,
            error: result.ok ? '' : result.error.message,
          })),
        };
      }),
    );
}
