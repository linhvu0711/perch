import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import {
  CHAR_LIMIT_DEFAULT,
  estimateCost,
  formatCost,
  weightedLength,
} from '@perch/core';
import type { Post } from '@perch/core';
import { FileText, FolderOpen, Trash2, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';

import { ApiError, errorMessage } from '@/lib/api';
import {
  useCreatePost,
  useDeletePosts,
  usePost,
  useUnlinkResources,
  useUpdatePost,
} from '@/lib/queries';

import { ConfirmDialog } from './ConfirmDialog';
import { IconButton } from './IconButton';
import { PostPreview } from './PostPreview';
import { ResourcesDrawer } from './ResourcesDrawer';
import { StatusPill } from './StatusPill';
import { toast } from './Toast';

const EMPTY_POST: Post = {
  id: 0,
  status: 'draft',
  title: '',
  text: '',
  scheduled_at: null,
  published_at: null,
  x_account_id: null,
  x_post_id: null,
  last_error: null,
  retry_count: 0,
  created_at: '',
  updated_at: '',
  character_count: 0,
  limit: CHAR_LIMIT_DEFAULT,
  estimated_cost: 0.015,
  links: [],
  media: [],
};

export function PostModal(): JSX.Element | null {
  const { id: idValue } = useParams();
  const navigate = useNavigate();
  const isNew = idValue === 'new';
  const parsedId =
    !isNew && idValue !== undefined && /^\d+$/.test(idValue) && Number(idValue) > 0
      ? Number(idValue)
      : null;
  const invalidId = !isNew && parsedId === null;

  const postQuery = usePost(isNew || invalidId ? null : parsedId);
  const createPost = useCreatePost();
  const updatePost = useUpdatePost();
  const deletePosts = useDeletePosts();
  const unlinkResources = useUnlinkResources();
  const modalRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number>(undefined);
  const savedRef = useRef(false);
  const pendingRef = useRef<{ title?: string; text?: string }>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | null>(null);
  const [drafts, setDrafts] = useState<{ title: string; text: string } | null>(
    null,
  );

  const post = postQuery.data;
  const readOnly = post?.status === 'published';
  const currentId = post?.id;

  useEffect(() => {
    setDrafts(null);
    savedRef.current = false;
  }, [currentId]);

  useEffect(() => {
    if (invalidId) navigate('/posts', { replace: true });
  }, [invalidId, navigate]);

  useEffect(() => {
    if (
      postQuery.error instanceof ApiError &&
      postQuery.error.status === 404
    ) {
      toast('Post not found', 'warn');
      navigate('/posts', { replace: true });
    }
  }, [navigate, postQuery.error]);

  useEffect(() => {
    modalRef.current?.focus();
  }, [currentId]);

  const requestClose = useCallback(() => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    if (savedRef.current) toast('Saved');
    navigate('/posts');
  }, [navigate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [requestClose]);

  const flush = useCallback(async () => {
    const patch = pendingRef.current;
    pendingRef.current = {};
    if (patch.title === undefined && patch.text === undefined) return;
    try {
      if (currentId === undefined) {
        const created = await createPost.mutateAsync({});
        savedRef.current = true;
        navigate(`/posts/${created.id}`, { replace: true });
        await updatePost.mutateAsync({ id: created.id, patch });
      } else {
        await updatePost.mutateAsync({ id: currentId, patch });
        savedRef.current = true;
      }
    } catch (error) {
      toast(errorMessage(error), 'warn');
    }
  }, [createPost, currentId, navigate, updatePost]);

  const scheduleSave = useCallback(
    (patch: { title?: string; text?: string }) => {
      pendingRef.current = { ...pendingRef.current, ...patch };
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void flush(), 600);
    },
    [flush],
  );

  const ensurePostId = useCallback(async (): Promise<number | null> => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    await flush();
    return postQuery.data?.id ?? currentId ?? null;
  }, [currentId, flush, postQuery.data?.id]);

  async function confirmDelete() {
    if (currentId === undefined) return;
    try {
      await deletePosts.mutateAsync([currentId]);
      setConfirm(null);
      navigate('/posts');
    } catch (error) {
      toast(errorMessage(error), 'warn');
      setConfirm(null);
    }
  }

  const loadingShell = (body: JSX.Element) => (
    <div
      className="scrim"
      onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Post"
        tabIndex={-1}
        ref={modalRef}
      >
        <div className="mhead">
          <span className="id">{isNew ? 'new' : `#${parsedId}`}</span>
          <div className="right">
            <IconButton label="Close (Esc)" icon={X} variant="ghost" onClick={requestClose} />
          </div>
        </div>
        <div className="mbody">
          <div className="editor">{body}</div>
        </div>
      </div>
    </div>
  );

  if (!isNew && postQuery.isPending) {
    return loadingShell(<div className="muted">Loading…</div>);
  }
  if (!isNew && postQuery.isError) {
    return loadingShell(
      <div className="muted">{errorMessage(postQuery.error)}</div>,
    );
  }

  const viewPost: Post = {
    ...(post ?? EMPTY_POST),
    title: drafts?.title ?? post?.title ?? '',
    text: drafts?.text ?? post?.text ?? '',
    character_count: weightedLength(drafts?.text ?? post?.text ?? ''),
    estimated_cost: estimateCost(drafts?.text ?? post?.text ?? ''),
  };
  const over = viewPost.character_count > viewPost.limit;
  const metricClass = over
    ? 'bad'
    : viewPost.character_count === 0
      ? 'warn'
      : 'ok';
  const hasUrl = viewPost.estimated_cost > 0.015;

  return (
    <>
      <div
        className="scrim"
        onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
      >
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label={viewPost.title !== '' ? viewPost.title : 'Post'}
          tabIndex={-1}
          ref={modalRef}
        >
          <div className="mhead">
            <span className="id">{isNew ? 'new' : `#${viewPost.id}`}</span>
            <StatusPill status={viewPost.status} />
            <span className="muted">
              {isNew ? 'New draft' : 'Not scheduled'}
            </span>
            <div className="right">
              {!isNew && (
                <IconButton
                  label="Delete post"
                  icon={Trash2}
                  variant="ghost"
                  onClick={() => setConfirm('delete')}
                />
              )}
              <IconButton
                label="Close (Esc)"
                icon={X}
                variant="ghost"
                onClick={requestClose}
              />
            </div>
          </div>
          <div className="mbody">
            <div className="editor">
              <div className="field">
                <input
                  type="text"
                  className="ptitle"
                  aria-label="Title"
                  placeholder="Title, only shown in Perch"
                  readOnly={readOnly}
                  value={viewPost.title}
                  onChange={(event) => {
                    setDrafts((prev) => ({
                      title: event.target.value,
                      text: prev?.text ?? post?.text ?? '',
                    }));
                    scheduleSave({ title: event.target.value });
                  }}
                />
                <textarea
                  className="ta"
                  aria-label="Text"
                  placeholder="What's happening?"
                  readOnly={readOnly}
                  value={viewPost.text}
                  onChange={(event) => {
                    setDrafts((prev) => ({
                      title: prev?.title ?? post?.title ?? '',
                      text: event.target.value,
                    }));
                    scheduleSave({ text: event.target.value });
                  }}
                />
              </div>
              <div className="field">
                <label>
                  Linked resources{' '}
                  <span className="faint">{viewPost.links.length}</span>
                  {!readOnly && (
                    <span className="right">
                      <IconButton
                        label="Browse resources"
                        icon={FolderOpen}
                        onClick={() => setDrawerOpen(true)}
                      />
                    </span>
                  )}
                </label>
                <div className="linked">
                  {viewPost.links.length === 0 && (
                    <span className="note">
                      No resources linked. Browse with the folder button.
                    </span>
                  )}
                  {viewPost.links.map((link) => (
                    <div key={link.resource_id} className="link">
                      <span className="k">
                        <FileText size={14} strokeWidth={1.75} />
                      </span>
                      <span className="ltitle">{link.title}</span>
                      {!readOnly && (
                        <button
                          type="button"
                          className="rm"
                          aria-label={`Unlink ${link.title}`}
                          title="Unlink"
                          onClick={() => {
                            if (currentId === undefined) return;
                            void unlinkResources
                              .mutateAsync({
                                id: currentId,
                                resource_ids: [link.resource_id],
                              })
                              .then(() => toast('Unlinked'))
                              .catch((error: unknown) =>
                                toast(errorMessage(error), 'warn'),
                              );
                          }}
                        >
                          <X size={14} strokeWidth={1.75} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="previewpane">
              <h2>Preview</h2>
              <PostPreview post={viewPost} />
              <div className="metrics">
                <div className="card metric">
                  <div className="l">Characters</div>
                  <div className={`v ${metricClass}`}>
                    {viewPost.character_count.toLocaleString()} /{' '}
                    {viewPost.limit.toLocaleString()}
                  </div>
                </div>
                <div className="card metric">
                  <div className="l">Estimated cost</div>
                  <div className={`v ${hasUrl ? 'warn' : ''}`}>
                    {formatCost(viewPost.estimated_cost)}
                  </div>
                </div>
                <div className="card metric">
                  <div className="l">Publish as</div>
                  <div className="v">—</div>
                </div>
              </div>
              <div className="note">
                {hasUrl ? (
                  <>
                    <b>This post has a link.</b> X bills it at $0.200 instead
                    of $0.015.
                  </>
                ) : (
                  <>
                    <b>Cost rule.</b> A post is $0.015. Any http(s) link makes
                    it $0.200. Images are free.
                  </>
                )}
              </div>
            </div>
            <ResourcesDrawer
              post={post ?? null}
              open={drawerOpen}
              ensurePostId={ensurePostId}
              onClose={() => setDrawerOpen(false)}
              onInsertText={(inserted) => {
                const text = viewPost.text;
                const next = (text !== '' ? `${text}\n\n` : '') + inserted;
                setDrafts((prev) => ({
                  title: prev?.title ?? post?.title ?? '',
                  text: next,
                }));
                scheduleSave({ text: next });
              }}
            />
          </div>
        </div>
      </div>
      {confirm === 'delete' && post && (
        <ConfirmDialog
          title={`Delete post #${post.id}?`}
          body={<p>Removes it from Perch. Linked resources are kept.</p>}
          ok="Delete"
          danger
          busy={deletePosts.isPending}
          onOk={() => void confirmDelete()}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}
