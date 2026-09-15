import fs from 'node:fs';
import path from 'node:path';

import {
  type ImageResource,
  MIRROR_MANIFEST_FILE,
  type MirrorManifest,
  mirrorFile,
  mirrorImagePath,
  mirrorManifestSchema,
  type Resource,
} from '@perch/core';

import { CliError } from './output';

function writeManifest(dir: string, manifest: MirrorManifest): void {
  const manifestPath = path.join(dir, MIRROR_MANIFEST_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const temporaryPath = `${manifestPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(temporaryPath, manifestPath);
}

export async function applyMirror(
  dir: string,
  resources: Resource[],
  now: Date,
  fetchImage: (id: number) => Promise<Uint8Array>,
): Promise<{ added: number; updated: number; removed: number; pulled_at: string }> {
  const manifestPath = path.join(dir, MIRROR_MANIFEST_FILE);
  let old: MirrorManifest = { pulled_at: null, paths: [] };
  if (fs.existsSync(manifestPath)) {
    let parsed: ReturnType<typeof mirrorManifestSchema.safeParse> | null = null;
    try {
      parsed = mirrorManifestSchema.safeParse(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
    } catch {
      // syntax or read error: treated as an invalid manifest below
    }
    if (!parsed?.success) {
      throw new CliError(
        'bad_manifest',
        `Manifest at ${manifestPath} is not valid; delete it to start over`,
      );
    }
    old = parsed.data;
  }

  const entries = resources.map(mirrorFile);
  const images = resources
    .filter((r): r is ImageResource => r.type === 'image')
    .map((r) => ({ id: r.id, path: mirrorImagePath(r), bytes: r.bytes }));
  const nextPaths = [...entries.map((e) => e.path), ...images.map((i) => i.path)].sort();

  const fetched = new Map<string, Uint8Array>();
  for (const image of images) {
    const full = path.join(dir, image.path);
    if (fs.existsSync(full) && fs.statSync(full).size === image.bytes) continue;
    fetched.set(image.path, await fetchImage(image.id));
  }

  fs.mkdirSync(dir, { recursive: true });

  writeManifest(dir, {
    pulled_at: old.pulled_at,
    paths: [...new Set([...old.paths, ...nextPaths])].sort(),
  });

  let added = 0;
  let updated = 0;
  let removed = 0;
  const written: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.path);
    try {
      const existing = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
      if (existing === entry.content) continue;
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, entry.content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError(
        'write_failed',
        `Disk error at ${entry.path}: ${message}. Written before the error: ${written.join(', ') || 'none'}`,
        written.map((p) => ({ path: p, message: 'written' })),
      );
    }
    written.push(entry.path);
    if (old.paths.includes(entry.path)) updated += 1;
    else added += 1;
  }
  for (const [imagePath, bytes] of fetched) {
    const full = path.join(dir, imagePath);
    try {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError(
        'write_failed',
        `Disk error at ${imagePath}: ${message}. Written before the error: ${written.join(', ') || 'none'}`,
        written.map((p) => ({ path: p, message: 'written' })),
      );
    }
    written.push(imagePath);
    if (old.paths.includes(imagePath)) updated += 1;
    else added += 1;
  }

  const root = path.resolve(dir);
  for (const p of old.paths) {
    if (nextPaths.includes(p)) continue;
    const full = path.resolve(root, p);
    const relative = path.relative(root, full);
    if (
      relative === '' ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      continue;
    if (fs.existsSync(full)) {
      fs.rmSync(full);
      removed += 1;
    }
  }

  const pulled_at = now.toISOString();
  writeManifest(dir, { pulled_at, paths: nextPaths });
  return { added, updated, removed, pulled_at };
}
