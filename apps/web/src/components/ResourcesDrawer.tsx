import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { Post, Resource } from '@perch/core';
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  LayoutGrid,
  Link2,
  Link2Off,
  Search,
  Type,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router';

import { errorMessage } from '@/lib/api';
import {
  useLinkResources,
  useResource,
  useResources,
  useUnlinkResources,
} from '@/lib/queries';

import { IconButton } from './IconButton';
import { Markdown } from './Markdown';
import { toast } from './Toast';

const DRAWER_PAGE_SIZE = 20;

function insertableText(resource: Resource): string {
  return resource.body
    .replace(/^# .*\n+/, '')
    .replace(/[#*`>]/g, '')
    .trim();
}

export function ResourcesDrawer(props: {
  post: Post | null;
  open: boolean;
  onClose(): void;
  onInsertText(text: string): void;
  ensurePostId?(): Promise<number | null>;
}): JSX.Element {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [viewId, setViewId] = useState<number | null>(null);


  const linkResources = useLinkResources();
  const unlinkResources = useUnlinkResources();

  useEffect(() => {
    if (props.open) {
      setViewId(null);
      setSearch('');
      setDebouncedSearch('');
    }
  }, [props.open]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const filters = useMemo(
    () => ({
      ...(debouncedSearch !== '' ? { search: debouncedSearch } : {}),
      order: 'desc' as const,
    }),
    [debouncedSearch],
  );
  const resources = useResources(filters, DRAWER_PAGE_SIZE);
  const items = resources.data?.pages.flatMap((page) => page.items) ?? [];
  const detail = useResource(viewId);

  const linkedIds = new Set(props.post?.links.map((link) => link.resource_id) ?? []);

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
      act(
        () =>
          linkResources.mutateAsync({ id: postId, resource_ids: [resource.id] }),
        'Linked',
      );
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
      <IconButton
        label="Insert text into post"
        icon={Type}
        onClick={() => insertText(resource)}
      />
      {linkedIds.has(resource.id) ? (
        <IconButton
          label="Unlink from post"
          icon={Link2Off}
          onClick={() => toggleLink(resource)}
        />
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
                navigate(`/resources/${viewId}`);
              }}
            />
            <IconButton
              label="Close"
              icon={X}
              variant="ghost"
              onClick={props.onClose}
            />
          </div>
          <div className="dview">
            {detail.isPending && <div className="muted">Loading…</div>}
            {detail.isError && (
              <div className="muted">{errorMessage(detail.error)}</div>
            )}
            {viewed && (
              <>
                <div className="body">
                  <Markdown body={viewed.body} />
                  {viewed.notes !== '' && (
                    <div className="note" style={{ marginTop: 10 }}>
                      <b>Your note.</b> {viewed.notes}
                    </div>
                  )}
                </div>
                <div className="acts">
                  <span className="note">
                    {linkedIds.has(viewed.id)
                      ? 'Linked to this post'
                      : 'Not linked'}
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
            <div className="seg icons" role="group" aria-label="Type">
              <button type="button" aria-label="All" title="All" aria-pressed>
                <LayoutGrid size={16} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                aria-label="Notes"
                title="Notes"
                aria-pressed={false}
                disabled
              >
                <FileText size={16} strokeWidth={1.75} />
              </button>
            </div>
            <IconButton
              label="Close"
              icon={X}
              variant="ghost"
              onClick={props.onClose}
            />
          </div>
          <div className="dlist">
            {items.map((resource) => (
              <div key={resource.id} className="ditem">
                <button
                  type="button"
                  className="ic"
                  title="View"
                  onClick={() => setViewId(resource.id)}
                >
                  <FileText size={16} strokeWidth={1.75} />
                </button>
                <div className="dmeta">
                  <button
                    type="button"
                    className="tt"
                    onClick={() => setViewId(resource.id)}
                  >
                    {resource.title}
                    {linkedIds.has(resource.id) && (
                      <span className="faint"> · linked</span>
                    )}
                  </button>
                  <div className="sub">
                    {insertableText(resource).slice(0, 80)}
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
            {resources.isPending && (
              <div className="countline">Loading…</div>
            )}
            {resources.hasNextPage &&
              (() => {
                const total = Math.max(
                  resources.data?.pages[0]?.total ?? 0,
                  items.length,
                );
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
    </div>
  );
}
