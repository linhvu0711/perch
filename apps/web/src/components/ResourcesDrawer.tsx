import type { Post, Resource } from '@perch/core';
import { IMAGE_BYTES_MAX, IMAGE_MIME_TYPES } from '@perch/core';
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  Image,
  LayoutGrid,
  Link2,
  Link2Off,
  Paperclip,
  Search,
  Type,
  Upload,
  X,
} from 'lucide-react';
import { type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { errorMessage } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import {
  useAttachFiles,
  useAttachMedia,
  useLinkResources,
  useResource,
  useResources,
  useUnlinkResources,
} from '@/lib/queries';

import { IconButton } from './IconButton';
import { Markdown } from './Markdown';
import { toast } from './Toast';

const DRAWER_PAGE_SIZE = 20;

function precheck(file: File): string | null {
  if (file.size > IMAGE_BYTES_MAX) return 'Over 5 MB';
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
    return 'Only PNG, JPG, WebP, or GIF';
  }
  return null;
}

function insertableText(resource: Resource): string {
  if (resource.type !== 'md') return '';
  return resource.body
    .replace(/^# .*\n+/, '')
    .replace(/[#*`>]/g, '')
    .trim();
}

export function ResourcesDrawer(props: {
  post: Post | null;
  open: boolean;
  initialType?: 'all' | 'md' | 'image';
  onClose(): void;
  onInsertText(text: string): void;
  ensurePostId?(): Promise<number | null>;
  onNavigate?(to: string): void;
}): JSX.Element {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [type, setType] = useState<'all' | 'md' | 'image'>(props.initialType ?? 'all');
  const [viewId, setViewId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const linkResources = useLinkResources();
  const unlinkResources = useUnlinkResources();
  const attachMedia = useAttachMedia();
  const attachFiles = useAttachFiles();

  useEffect(() => {
    if (props.open) {
      setViewId(null);
      setSearch('');
      setDebouncedSearch('');
      setType(props.initialType ?? 'all');
    }
  }, [props.open, props.initialType]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const filters = useMemo(
    () => ({
      ...(debouncedSearch !== '' ? { search: debouncedSearch } : {}),
      ...(type !== 'all' ? { type } : {}),
      order: 'desc' as const,
    }),
    [debouncedSearch, type],
  );
  const resources = useResources(filters, DRAWER_PAGE_SIZE);
  const items = resources.data?.pages.flatMap((page) => page.items) ?? [];
  const detail = useResource(viewId);

  const linkedIds = new Set(props.post?.links.map((link) => link.resource_id) ?? []);
  const mediaCount = props.post?.media.length ?? 0;

  const act = (fn: () => Promise<unknown>, message: string) => {
    void fn()
      .then(() => toast(message))
      .catch((error: unknown) => toast(errorMessage(error), 'warn'));
  };

  const toggleLink = (resource: Resource) => {
    void (async () => {
      const postId = props.post?.id ?? (await props.ensurePostId?.());
      if (postId === undefined || postId === null) return;
      if (linkedIds.has(resource.id)) {
        act(
          () =>
            unlinkResources.mutateAsync({
              id: postId,
              resource_ids: [resource.id],
            }),
          'Unlinked',
        );
      } else {
        act(() => linkResources.mutateAsync({ id: postId, resource_ids: [resource.id] }), 'Linked');
      }
    })();
  };

  const attach = (resource: Resource) => {
    void (async () => {
      const postId = props.post?.id ?? (await props.ensurePostId?.());
      if (postId === undefined || postId === null) return;
      try {
        const response = await attachMedia.mutateAsync({
          id: postId,
          resource_ids: [resource.id],
        });
        const result = response.results[0];
        if (result !== undefined && result.ok) {
          toast(`Attached ${resource.title}`);
        } else if (result !== undefined && !result.ok) {
          toast(result.error.message, 'warn');
        }
      } catch (error) {
        toast(errorMessage(error), 'warn');
      }
    })();
  };

  const uploadToPost = (incoming: FileList | null) => {
    void (async () => {
      if (!incoming || incoming.length === 0) return;
      const files: File[] = [];
      let overflow = false;
      for (const file of incoming) {
        const bad = precheck(file);
        if (bad !== null) {
          toast(`${file.name}: ${bad}`, 'warn');
          continue;
        }
        if (mediaCount + files.length >= 4) {
          overflow = true;
          break;
        }
        files.push(file);
      }
      if (overflow) toast('4 images max', 'warn');
      if (files.length === 0) return;
      const postId = props.post?.id ?? (await props.ensurePostId?.());
      if (postId === undefined || postId === null) return;
      try {
        const response = await attachFiles.mutateAsync({ id: postId, files });
        const failed = response.results.filter((result) => !result.ok);
        const okCount = response.results.length - failed.length;
        if (okCount === 1) {
          const ok = response.results.find((result) => result.ok);
          if (ok !== undefined) toast(`Attached ${ok.name}`);
        } else if (okCount > 1) {
          toast(`Attached ${okCount} images`);
        }
        const first = failed[0];
        if (first !== undefined && !first.ok) toast(first.error.message, 'warn');
      } catch (error) {
        toast(errorMessage(error), 'warn');
      }
    })();
  };

  const insertText = (resource: Resource) => {
    const text = insertableText(resource);
    if (text === '') return;
    props.onInsertText(text);
    void (async () => {
      const postId = props.post?.id ?? (await props.ensurePostId?.());
      if (postId !== undefined && postId !== null && !linkedIds.has(resource.id)) {
        await linkResources
          .mutateAsync({ id: postId, resource_ids: [resource.id] })
          .catch((error: unknown) => toast(errorMessage(error), 'warn'));
      }
      toast('Text inserted');
    })();
  };

  const actions = (resource: Resource) => (
    <div className="acts">
      {resource.type === 'image' ? (
        <IconButton
          label="Attach to post"
          icon={Paperclip}
          disabled={mediaCount >= 4}
          onClick={() => attach(resource)}
        />
      ) : (
        <IconButton
          label="Insert text into post"
          icon={Type}
          onClick={() => insertText(resource)}
        />
      )}
      {linkedIds.has(resource.id) ? (
        <IconButton label="Unlink from post" icon={Link2Off} onClick={() => toggleLink(resource)} />
      ) : (
        <IconButton
          label="Link to post"
          icon={Link2}
          variant="primary"
          onClick={() => toggleLink(resource)}
        />
      )}
    </div>
  );

  const viewed = viewId !== null ? detail.data : undefined;

  return (
    <div className={`drawer${props.open ? ' on' : ''}`}>
      {viewId !== null ? (
        <>
          <div className="dhead">
            <IconButton
              label="Back to list"
              icon={ArrowLeft}
              variant="ghost"
              onClick={() => setViewId(null)}
            />
            <span className="k">
              <FileText size={14} strokeWidth={1.75} />
            </span>
            <b className="dtitle">{viewed?.title ?? 'Loading…'}</b>
            <IconButton
              label="Open full resource"
              icon={ExternalLink}
              variant="ghost"
              onClick={() => {
                props.onClose();
                (props.onNavigate ?? navigate)(`/resources/${viewId}`);
              }}
            />
            <IconButton label="Close" icon={X} variant="ghost" onClick={props.onClose} />
          </div>
          <div className="dview">
            {detail.isPending && <div className="muted">Loading…</div>}
            {detail.isError && <div className="muted">{errorMessage(detail.error)}</div>}
            {viewed && (
              <>
                <div className="body">
                  {viewed.type === 'image' ? (
                    <img
                      src={`/api/resources/${viewed.id}/file`}
                      alt={viewed.title}
                      style={{ width: '100%', borderRadius: 8 }}
                    />
                  ) : (
                    <Markdown body={viewed.type === 'md' ? viewed.body : ''} />
                  )}
                  {viewed.notes !== '' && (
                    <div className="note" style={{ marginTop: 10 }}>
                      <b>Your note.</b> {viewed.notes}
                    </div>
                  )}
                </div>
                <div className="acts">
                  <span className="note">
                    {linkedIds.has(viewed.id) ? 'Linked to this post' : 'Not linked'}
                  </span>
                  {actions(viewed)}
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="dhead">
            <div className="search">
              <Search size={16} strokeWidth={1.75} />
              <input
                aria-label="Search resources"
                placeholder="Search resources"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            {/* biome-ignore lint/a11y/useSemanticElements: icon-only segmented control */}
            <div className="seg icons" role="group" aria-label="Type">
              <button
                type="button"
                aria-label="All"
                title="All"
                aria-pressed={type === 'all'}
                onClick={() => setType('all')}
              >
                <LayoutGrid size={16} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                aria-label="Images"
                title="Images"
                aria-pressed={type === 'image'}
                onClick={() => setType('image')}
              >
                <Image size={16} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                aria-label="Notes"
                title="Notes"
                aria-pressed={type === 'md'}
                onClick={() => setType('md')}
              >
                <FileText size={16} strokeWidth={1.75} />
              </button>
            </div>
            <IconButton label="Close" icon={X} variant="ghost" onClick={props.onClose} />
          </div>
          <div className="dlist">
            {(type === 'image' || type === 'all') && (
              <div className="ditem">
                <span className="ic">
                  <Upload size={16} strokeWidth={1.75} />
                </span>
                <div className="dmeta">
                  <div className="tt">Upload from computer</div>
                  <div className="sub">
                    PNG, JPG, WebP, GIF · 5 MB max · attaches without making a resource
                  </div>
                </div>
                <div className="acts">
                  <IconButton
                    label="Upload and attach"
                    icon={Upload}
                    disabled={mediaCount >= 4}
                    onClick={() => fileInputRef.current?.click()}
                  />
                </div>
              </div>
            )}
            {items.map((resource) => (
              <div key={resource.id} className="ditem">
                <button
                  type="button"
                  className="ic"
                  title="View"
                  onClick={() => setViewId(resource.id)}
                >
                  {resource.type === 'image' ? (
                    <img src={`/api/resources/${resource.id}/file`} alt="" />
                  ) : (
                    <FileText size={16} strokeWidth={1.75} />
                  )}
                </button>
                <div className="dmeta">
                  <button type="button" className="tt" onClick={() => setViewId(resource.id)}>
                    {resource.title}
                    {linkedIds.has(resource.id) && <span className="faint"> · linked</span>}
                  </button>
                  <div className="sub">
                    {resource.type === 'image'
                      ? `${formatBytes(resource.bytes)} · ${resource.width} × ${resource.height}`
                      : insertableText(resource).slice(0, 80)}
                  </div>
                </div>
                {actions(resource)}
              </div>
            ))}
            {!resources.isPending && items.length === 0 && (
              <div className="empty">
                <b>Nothing found</b>
              </div>
            )}
            {resources.isPending && <div className="countline">Loading…</div>}
            {resources.hasNextPage &&
              (() => {
                const total = Math.max(resources.data?.pages[0]?.total ?? 0, items.length);
                const left = total - items.length;
                return (
                  <div className="loadmore">
                    <button
                      type="button"
                      disabled={resources.isFetchingNextPage}
                      onClick={() => void resources.fetchNextPage()}
                    >
                      Load more
                    </button>
                    <span>
                      · {Math.min(DRAWER_PAGE_SIZE, left)} of {left} left
                    </span>
                  </div>
                );
              })()}
          </div>
        </>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(event) => {
          uploadToPost(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}
