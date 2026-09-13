import type { Post, PostMedia } from '@perch/core';
import {
  CHAR_LIMIT_DEFAULT,
  COST_POST_USD,
  COST_POST_WITH_URL_USD,
  DEFAULT_TIMEZONE,
  estimateCost,
  formatCost,
  POST_MEDIA_MAX,
  readyChecks,
  weightedLength,
} from '@perch/core';
import {
  ArrowDown,
  ArrowUp,
  Check,
  FileText,
  FolderOpen,
  Plus,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { ApiError, errorMessage } from '@/lib/api';
import { formatSchedule } from '@/lib/format';
import {
  useAccount,
  useCreatePost,
  useDeletePosts,
  useDemotePosts,
  useDetachMedia,
  usePost,
  usePromotePosts,
  useSchedulePost,
  useSettings,
  useTagPosts,
  useUnlinkResources,
  useUnschedulePosts,
  useUntagPosts,
  useUpdatePost,
} from '@/lib/queries';

import { ConfirmDialog } from './ConfirmDialog';
import { DateTimePicker } from './DateTimePicker';
import { IconButton } from './IconButton';
import { Lightbox } from './Lightbox';
import { PostPreview } from './PostPreview';
import { ResourcesDrawer } from './ResourcesDrawer';
import { StatusPill } from './StatusPill';
import { TagField } from './TagField';
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
  tags: [],
  estimated_cost: COST_POST_USD,
  links: [],
  media: [],
  ready: { ok: false, checks: [] },
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
  const account = useAccount();
  const settings = useSettings();
  const timeZone = settings.data?.timezone ?? DEFAULT_TIMEZONE;
  const createPost = useCreatePost();
  const updatePost = useUpdatePost();
  const deletePosts = useDeletePosts();
  const promotePosts = usePromotePosts();
  const demotePosts = useDemotePosts();
  const schedulePost = useSchedulePost();
  const unschedulePosts = useUnschedulePosts();
  const unlinkResources = useUnlinkResources();
  const tagPosts = useTagPosts();
  const untagPosts = useUntagPosts();
  const detachMedia = useDetachMedia();
  const modalRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<number>(undefined);
  const closedRef = useRef(false);
  const savedRef = useRef(false);
  const pendingRef = useRef<{ title?: string; text?: string }>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerType, setDrawerType] = useState<'all' | 'image'>('all');
  const [confirm, setConfirm] = useState<'delete' | null>(null);
  const [confirmDetach, setConfirmDetach] = useState<PostMedia | null>(null);
  const [lightbox, setLightbox] = useState<PostMedia | null>(null);
  const [drafts, setDrafts] = useState<{ title: string; text: string } | null>(null);

  const post = postQuery.data;
  const readOnly = post?.status === 'published';
  const currentId = post?.id;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the post changes
  useEffect(() => {
    setDrafts(null);
    savedRef.current = false;
  }, [currentId]);

  useEffect(() => {
    if (invalidId) navigate('/posts', { replace: true });
  }, [invalidId, navigate]);

  useEffect(() => {
    if (postQuery.error instanceof ApiError && postQuery.error.status === 404) {
      toast('Post not found', 'warn');
      navigate('/posts', { replace: true });
    }
  }, [navigate, postQuery.error]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: focus when the post changes
  useEffect(() => {
    const modal = modalRef.current;
    if (modal && !modal.contains(document.activeElement)) modal.focus();
  }, [currentId]);

  const createRef = useRef<Promise<Post> | null>(null);

  const ensureCreated = useCallback((): Promise<Post> => {
    createRef.current ??= createPost
      .mutateAsync({})
      .then((created) => {
        savedRef.current = true;
        if (!closedRef.current) {
          navigate(`/posts/${created.id}`, { replace: true });
        }
        return created;
      })
      .catch((error: unknown) => {
        createRef.current = null;
        throw error;
      });
    return createRef.current;
  }, [createPost, navigate]);

  const queueRef = useRef<Promise<boolean>>(Promise.resolve(true));

  const flush = useCallback((): Promise<boolean> => {
    queueRef.current = queueRef.current.then(async () => {
      const patch = pendingRef.current;
      const hasChanges = patch.title !== undefined || patch.text !== undefined;
      pendingRef.current = {};
      let id = currentId;
      if (id === undefined) {
        if (!hasChanges && createRef.current === null) return true;
        try {
          id = (await ensureCreated()).id;
        } catch (error) {
          pendingRef.current = { ...patch, ...pendingRef.current };
          toast(errorMessage(error), 'warn');
          return false;
        }
      }
      if (!hasChanges) return true;
      try {
        await updatePost.mutateAsync({ id, patch });
        savedRef.current = true;
        return true;
      } catch (error) {
        pendingRef.current = { ...patch, ...pendingRef.current };
        toast(errorMessage(error), 'warn');
        return false;
      }
    });
    return queueRef.current;
  }, [currentId, ensureCreated, updatePost]);

  const drain = useCallback(async (): Promise<boolean> => {
    let ok = await flush();
    while (
      ok &&
      (pendingRef.current.title !== undefined || pendingRef.current.text !== undefined)
    ) {
      ok = await flush();
    }
    return ok;
  }, [flush]);

  const requestClose = useCallback(() => {
    closedRef.current = true;
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    void (async () => {
      const ok = await drain();
      if (!ok) {
        closedRef.current = false;
        return;
      }
      if (savedRef.current) toast('Saved');
      navigate('/posts');
    })().catch((error: unknown) => {
      closedRef.current = false;
      toast(errorMessage(error), 'warn');
    });
  }, [drain, navigate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (confirm !== null) {
        setConfirm(null);
        return;
      }
      if (confirmDetach !== null) {
        setConfirmDetach(null);
        return;
      }
      requestClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirm, confirmDetach, requestClose]);

  const linkTitle = useCallback(
    (resourceId: number): string =>
      post?.links.find((link) => link.resource_id === resourceId)?.title ??
      `Resource ${resourceId}`,
    [post],
  );

  const detachOne = useCallback(
    (media: PostMedia) => {
      if (currentId === undefined) return;
      void detachMedia
        .mutateAsync({ id: currentId, positions: [media.position] })
        .then(() =>
          toast(
            media.from_resource_id !== null
              ? 'Image removed. The resource is still linked.'
              : 'Image removed',
          ),
        )
        .catch((error: unknown) => toast(errorMessage(error), 'warn'));
    },
    [currentId, detachMedia],
  );

  const mediaTitle = useCallback(
    (media: PostMedia): string =>
      media.from_resource_id !== null ? linkTitle(media.from_resource_id) : 'Uploaded file',
    [linkTitle],
  );

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
    if (currentId !== undefined) return currentId;
    try {
      return (await ensureCreated()).id;
    } catch (error) {
      toast(errorMessage(error), 'warn');
      return null;
    }
  }, [currentId, ensureCreated, flush]);

  const openResource = useCallback(
    (to: string) => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      void (async () => {
        const ok = await drain();
        if (ok) navigate(to);
      })().catch((error: unknown) => toast(errorMessage(error), 'warn'));
    },
    [drain, navigate],
  );

  async function confirmDelete() {
    if (currentId === undefined) return;
    try {
      const response = await deletePosts.mutateAsync([currentId]);
      const result = response.results.find((r) => r.id === currentId);
      if (result === undefined || !result.ok) {
        throw new Error(
          result !== undefined && !result.ok ? result.error.message : 'Delete failed',
        );
      }
      setConfirm(null);
      navigate('/posts');
      toast('Deleted');
    } catch (error) {
      toast(errorMessage(error), 'warn');
      setConfirm(null);
    }
  }

  const loadingShell = (body: JSX.Element) => (
    // biome-ignore lint/a11y/noStaticElementInteractions: scrim click-to-close
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
    return loadingShell(<div className="muted">{errorMessage(postQuery.error)}</div>);
  }

  const viewPost: Post = {
    ...(post ?? EMPTY_POST),
    title: drafts?.title ?? post?.title ?? '',
    text: drafts?.text ?? post?.text ?? '',
    character_count: weightedLength(drafts?.text ?? post?.text ?? ''),
    estimated_cost: estimateCost(drafts?.text ?? post?.text ?? ''),
    limit: post?.limit ?? account.data?.char_limit ?? CHAR_LIMIT_DEFAULT,
  };
  const over = viewPost.character_count > viewPost.limit;
  const metricClass = over ? 'bad' : viewPost.character_count === 0 ? 'warn' : 'ok';
  const hasUrl = viewPost.estimated_cost > COST_POST_USD;

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: scrim click-to-close */}
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
              {isNew
                ? 'New draft'
                : viewPost.scheduled_at !== null
                  ? `Scheduled · ${formatSchedule(viewPost.scheduled_at, timeZone)}`
                  : 'Not scheduled'}
            </span>
            <div className="right">
              {!isNew && viewPost.status === 'draft' && (
                <IconButton
                  label="Promote to official"
                  icon={ArrowUp}
                  variant="primary"
                  onClick={() => {
                    if (currentId === undefined) return;
                    void (async () => {
                      const ok = await drain();
                      if (!ok) return;
                      try {
                        const response = await promotePosts.mutateAsync([currentId]);
                        const result = response.results[0];
                        if (result !== undefined && result.ok) {
                          toast('Promoted');
                        } else if (result !== undefined) {
                          toast(result.error.errors?.[0]?.message ?? result.error.message, 'warn');
                        }
                      } catch (error) {
                        toast(errorMessage(error), 'warn');
                      }
                    })();
                  }}
                />
              )}
              {!isNew && (viewPost.status === 'official' || viewPost.status === 'failed') && (
                <IconButton
                  label="Demote to draft"
                  icon={ArrowDown}
                  variant="ghost"
                  onClick={() => {
                    if (currentId === undefined) return;
                    void demotePosts
                      .mutateAsync([currentId])
                      .then((response) => {
                        if (response.results[0]?.ok) toast('Demoted to draft');
                      })
                      .catch((error: unknown) => toast(errorMessage(error), 'warn'));
                  }}
                />
              )}
              {!isNew && (
                <IconButton
                  label="Delete post"
                  icon={Trash2}
                  variant="ghost"
                  className="danger"
                  onClick={() => setConfirm('delete')}
                />
              )}
              <IconButton label="Close (Esc)" icon={X} variant="ghost" onClick={requestClose} />
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
                  ref={textareaRef}
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
                {/* biome-ignore lint/a11y/noLabelWithoutControl: section label for the links list */}
                {/* biome-ignore lint/a11y/noLabelWithoutControl: section label for the slot grid */}
                <label>
                  Images{' '}
                  <span className="faint">
                    {viewPost.media.length} of {POST_MEDIA_MAX}
                  </span>
                </label>
                <div className="slots">
                  {[0, 1, 2, 3].slice(0, POST_MEDIA_MAX).map((index) => {
                    const media = viewPost.media[index];
                    if (media === undefined) {
                      return (
                        <button
                          key={`empty-${index}`}
                          type="button"
                          className="slot"
                          title="Add image"
                          aria-label="Add image"
                          disabled={readOnly}
                          onClick={() => {
                            setDrawerType('image');
                            setDrawerOpen(true);
                          }}
                        >
                          {index === viewPost.media.length && <Plus size={18} strokeWidth={1.75} />}
                        </button>
                      );
                    }
                    const caption = mediaTitle(media);
                    return (
                      // biome-ignore lint/a11y/useSemanticElements: holds a nested remove button
                      <div
                        key={media.id}
                        className="slot filled"
                        role="button"
                        tabIndex={0}
                        title={
                          media.from_resource_id !== null
                            ? `From ${caption}. Click to view.`
                            : 'Uploaded file. Click to view.'
                        }
                        onClick={() => setLightbox(media)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') setLightbox(media);
                        }}
                      >
                        <img
                          src={`/api/posts/${viewPost.id}/media/${media.id}/file`}
                          alt={caption}
                        />
                        {!readOnly && (
                          <button
                            type="button"
                            className="x"
                            title="Remove"
                            aria-label={`Remove image ${media.position}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (media.from_resource_id !== null) {
                                detachOne(media);
                              } else {
                                setConfirmDetach(media);
                              }
                            }}
                          >
                            <X size={11} strokeWidth={2.5} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="field">
                {/* biome-ignore lint/a11y/noLabelWithoutControl: section label for the picker */}
                <label>Schedule</label>
                <DateTimePicker
                  value={viewPost.scheduled_at}
                  timeZone={timeZone}
                  disabled={readOnly}
                  onSet={(at) => {
                    void (async () => {
                      const postId = await ensurePostId();
                      if (postId === null) return;
                      try {
                        await schedulePost.mutateAsync({ id: postId, at });
                        toast('Schedule saved');
                      } catch (error) {
                        toast(errorMessage(error), 'warn');
                      }
                    })();
                  }}
                  onClear={() => {
                    if (currentId === undefined) return;
                    void unschedulePosts
                      .mutateAsync([currentId])
                      .then(() => toast('Schedule cleared'))
                      .catch((error: unknown) => toast(errorMessage(error), 'warn'));
                  }}
                />
                {viewPost.status === 'draft' && viewPost.scheduled_at !== null && (
                  <span className="note">
                    A scheduled <b>draft</b> is not sent. Promote it so the scheduler sends it.
                  </span>
                )}
              </div>
              <div className="field">
                {/* biome-ignore lint/a11y/noLabelWithoutControl: section label for the links list */}
                <label>
                  Linked resources <span className="faint">{viewPost.links.length}</span>
                  {!readOnly && (
                    <span className="right">
                      <IconButton
                        label="Browse resources"
                        icon={FolderOpen}
                        onClick={() => {
                          setDrawerType('all');
                          setDrawerOpen(true);
                        }}
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
                              .catch((error: unknown) => toast(errorMessage(error), 'warn'));
                          }}
                        >
                          <X size={14} strokeWidth={1.75} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              {currentId !== undefined && (
                <TagField
                  tags={viewPost.tags}
                  readOnly={readOnly}
                  onAdd={(name) =>
                    void tagPosts
                      .mutateAsync({ ids: [currentId], tags: [name] })
                      .then(() => toast(`Tagged ${name}`))
                      .catch((error: unknown) => toast(errorMessage(error), 'warn'))
                  }
                  onRemove={(name) =>
                    void untagPosts
                      .mutateAsync({ ids: [currentId], tags: [name] })
                      .then(() => toast('Untagged'))
                      .catch((error: unknown) => toast(errorMessage(error), 'warn'))
                  }
                />
              )}
            </div>
            <div className="previewpane">
              <h2>Preview</h2>
              <PostPreview post={viewPost} />
              <div className="metrics">
                <div className="card metric">
                  <div className="l">Characters</div>
                  <div className={`v ${metricClass}`}>
                    {viewPost.character_count.toLocaleString()} / {viewPost.limit.toLocaleString()}
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
                  <div className="v">
                    {account.data?.account != null ? `@${account.data.account.username}` : '—'}
                  </div>
                </div>
              </div>
              {!readOnly && (
                <div>
                  <h2>Ready to publish?</h2>
                  <ul className="checks">
                    {readyChecks({
                      text: viewPost.text,
                      limit: viewPost.limit,
                      mediaCount: viewPost.media.length,
                      accountConnected: account.data?.account != null,
                    }).checks.map((check) => (
                      <li key={check.code} className={check.ok ? 'ok' : 'bad'}>
                        {check.ok ? (
                          <Check size={14} strokeWidth={2} />
                        ) : (
                          <TriangleAlert size={14} strokeWidth={1.75} />
                        )}
                        {check.label}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="note">
                {hasUrl ? (
                  <>
                    <b>This post has a link.</b> X bills it at {formatCost(COST_POST_WITH_URL_USD)}{' '}
                    instead of {formatCost(COST_POST_USD)}.
                  </>
                ) : (
                  <>
                    <b>Cost rule.</b> A post is {formatCost(COST_POST_USD)}. Any http(s) link makes
                    it {formatCost(COST_POST_WITH_URL_USD)}. Images are free.
                  </>
                )}
              </div>
            </div>
            <ResourcesDrawer
              post={post ?? null}
              open={drawerOpen}
              initialType={drawerType}
              ensurePostId={ensurePostId}
              onClose={() => setDrawerOpen(false)}
              onNavigate={openResource}
              onInsertText={(inserted) => {
                const text = viewPost.text;
                const next = (text !== '' ? `${text}\n\n` : '') + inserted;
                setDrafts((prev) => ({
                  title: prev?.title ?? post?.title ?? '',
                  text: next,
                }));
                scheduleSave({ text: next });
                textareaRef.current?.focus();
              }}
            />
          </div>
        </div>
      </div>
      {lightbox !== null && (
        <Lightbox
          src={`/api/posts/${viewPost.id}/media/${lightbox.id}/file`}
          caption={mediaTitle(lightbox)}
          onClose={() => setLightbox(null)}
        />
      )}
      {confirmDetach !== null && currentId !== undefined && (
        <ConfirmDialog
          title="Remove this image?"
          body={
            <p>
              It was uploaded straight to the post and is <b>not a resource</b>. Removing it deletes
              the file. You would have to upload it again.
            </p>
          }
          ok="Remove"
          danger
          busy={detachMedia.isPending}
          onOk={() => {
            const media = confirmDetach;
            setConfirmDetach(null);
            detachOne(media);
          }}
          onCancel={() => setConfirmDetach(null)}
        />
      )}
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
