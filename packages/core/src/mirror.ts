import { z } from 'zod';

import type { ImageResource, Resource } from './resources';

export function slugify(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'untitled'
  );
}

export function mirrorBaseName(r: Pick<Resource, 'id' | 'title' | 'created_at'>): string {
  return `${r.created_at.slice(0, 10)}-${r.id}-${slugify(r.title)}`;
}

export function mirrorFileName(r: Pick<Resource, 'id' | 'title' | 'created_at'>): string {
  return `${mirrorBaseName(r)}.md`;
}

export function mirrorImagePath(r: ImageResource): string {
  return `images/${mirrorBaseName(r)}${r.path.slice(r.path.lastIndexOf('.'))}`;
}

export function mirrorFrontMatter(r: Resource): string {
  const lines = [
    '---',
    `id: ${r.id}`,
    `type: ${JSON.stringify(r.type)}`,
    `title: ${JSON.stringify(r.title)}`,
    `created_at: ${JSON.stringify(r.created_at)}`,
    'tags: []',
  ];
  if (r.notes === '') {
    lines.push('notes: ""');
  } else {
    lines.push('notes: |', ...r.notes.split('\n').map((line) => `  ${line}`));
  }
  if (r.type === 'tweet') {
    lines.push(
      `url: ${JSON.stringify(r.url)}`,
      `author: ${JSON.stringify(r.author_username)}`,
      `author_id: ${JSON.stringify(r.author_id)}`,
      `posted_at: ${JSON.stringify(r.posted_at)}`,
    );
  }
  if (r.type === 'image') {
    lines.push(
      `file: ${JSON.stringify(mirrorImagePath(r))}`,
      `mime: ${JSON.stringify(r.mime)}`,
      `bytes: ${r.bytes}`,
      `width: ${r.width}`,
      `height: ${r.height}`,
    );
  }
  lines.push('---');
  return `${lines.join('\n')}\n`;
}

export function mirrorFile(r: Resource): { path: string; content: string } {
  if (r.type === 'tweet') {
    return {
      path: `tweets/${mirrorFileName(r)}`,
      content: mirrorFrontMatter(r) + r.text + (r.text.endsWith('\n') ? '' : '\n'),
    };
  }
  if (r.type === 'image') {
    return { path: `images/${mirrorFileName(r)}`, content: mirrorFrontMatter(r) };
  }
  return {
    path: `notes/${mirrorFileName(r)}`,
    content: mirrorFrontMatter(r) + r.body + (r.body.endsWith('\n') ? '' : '\n'),
  };
}

export const MIRROR_MANIFEST_FILE = 'manifest.json';
export const mirrorManifestSchema = z.object({
  pulled_at: z.string().nullable(),
  paths: z.array(z.string()),
});
export type MirrorManifest = z.infer<typeof mirrorManifestSchema>;
