import type { Post, PostMedia } from '@perch/core';
import {
  CHAR_LIMIT_DEFAULT,
  DEFAULT_TIMEZONE,
  estimateCost,
  formatCost,
  POST_MEDIA_MAX,
  readyChecks,
  weightedLength,
  X_COSTS_USD,
} from '@perch/core';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ExternalLink,
  FileText,
  FolderOpen,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { ApiError, errorMessage } from '@/lib/api';
import { formatSchedule } from '@/lib/format';
import { usePostEditor } from '@/lib/postEditor';
import {
  useAccount,
  useDeletePosts,
  useDemotePosts,
  useDetachMedia,
  usePromotePosts,
  usePublishPost,
  useRetryPost,
  useSchedulePost,
  useSettings,
  useTagPosts,
  useUnlinkResources,
  useUnschedulePosts,
  useUntagPosts,
} from '@/lib/queries';

import { ConfirmDialog } from './ConfirmDialog';
import { DateTimePicker } from './DateTimePicker';
import { IconButton } from './IconButton';
import { IconLink } from './IconLink';
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
  x_post_url: null,
  last_error: null,
  retry_count: 0,
  created_at: '',
  updated_at: '',
  character_count: 0,
  limit: CHAR_LIMIT_DEFAULT,
  tags: [],
  estimated_cost: X_COSTS_USD.publish,
  links: [],
  media: [],
  ready: { ok: false, checks: [] },
  missed: false,
  reason: null,
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

  const queryClient = useQueryClient();
  const editor = usePostEditor(isNew || invalidId ? null : parsedId);
  const account = useAccount();
  const settings = useSettings();
  const timeZone = settings.data?.timezone ?? DEFAULT_TIMEZONE;
  const deletePosts = useDeletePosts();
  const promotePosts = usePromotePosts();
  const demotePosts = useDemotePosts();
  const schedulePost = useSchedulePost();
  const unschedulePosts = useUnschedulePosts();
  const publishPost = usePublishPost();
  const retryPost = useRetryPost();
  const unlinkResources = useUnlinkResources();
  const tagPosts = useTagPosts();
  const untagPosts = useUntagPosts();
  const detachMedia = useDetachMedia();
  const modalRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerType, setDrawerType] = useState<'all' | 'image'>('all');
  const [confirm, setConfirm] = useState<'delete' | 'publish' | 'retry' | null>(null);
  const [confirmDetach, setConfirmDetach] = useState<PostMedia | null>(null);
  const [lightbox, setLightbox] = useState<PostMedia | null>(null);

  const post = editor.post;
  const readOnly = post?.status === 'published';
  const currentId = post?.id;

  useEffect(() => {
    if (invalidId) navigate('..', { replace: true });
  }, [invalidId, navigate]);

  // the scheduler may have sent or missed the open post while the modal was up
  useEffect(() => {
    return () => {
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] });
    };
  }, [queryClient]);

  useEffect(() => {
    if (editor.error instanceof ApiError && editor.error.status === 404) {
      toast('Post not found', 'warn');
      navigate('..', { replace: true });
    }
  }, [navigate, editor.error]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: focus when the post changes
  useEffect(() => {
    const modal = modalRef.current;
    if (modal && !modal.contains(document.activeElement)) modal.focus();
  }, [currentId]);

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
      editor.close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirm, confirmDetach, editor]);

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

  const openResource = useCallback(
    (to: string) => {
      void (async () => {
        const id = await editor.ensureId();
        if (id !== null) navigate(to);
      })().catch((error: unknown) => toast(errorMessage(error), 'warn'));
    },
    [editor, navigate],
  );

  async function openDrawer(type: 'all' | 'image') {
    const id = await editor.ensureId();
    if (id === null) return;
    setDrawerType(type);
    setDrawerOpen(true);
  }

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
      navigate('..');
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
      onMouseDown={(event) => event.target === event.currentTarget && editor.close()}
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
            <IconButton label="Close (Esc)" icon={X} variant="ghost" onClick={editor.close} />
          </div>
        </div>
        <div className="mbody">
          <div className="editor">{body}</div>
        </div>
      </div>
    </div>
  );

  if (!isNew && editor.isPending) {
    return loadingShell(<div className="muted">Loading…</div>);
  }
  if (!isNew && editor.error !== null) {
    return loadingShell(<div className="muted">{errorMessage(editor.error)}</div>);
  }

  const viewPost: Post = {
    ...(post ?? EMPTY_POST),
    title: editor.title,
    text: editor.text,
    character_count: weightedLength(editor.text),
    estimated_cost: estimateCost(editor.text),
    limit: post?.limit ?? account.data?.char_limit ?? CHAR_LIMIT_DEFAULT,
  };
  const over = viewPost.character_count > viewPost.limit;
  const metricClass = over ? 'bad' : viewPost.character_count === 0 ? 'warn' : 'ok';
  const hasUrl = viewPost.estimated_cost > X_COSTS_USD.publish;

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: scrim click-to-close */}
      <div
        className="scrim"
        onMouseDown={(event) => event.target === event.currentTarget && editor.close()}
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
            <StatusPill status={viewPost.missed ? 'missed' : viewPost.status} />
            <span className="muted">
              {isNew
                ? 'New draft'
                : viewPost.status === 'published'
                  ? `Published${viewPost.published_at !== null ? ` · ${formatSchedule(viewPost.published_at, timeZone)}` : ''}`
                  : viewPost.status === 'failed'
                    ? `Failed${viewPost.scheduled_at !== null ? ` · ${formatSchedule(viewPost.scheduled_at, timeZone)}` : ''} · ${viewPost.retry_count} ${viewPost.retry_count === 1 ? 'try' : 'tries'}`
                    : viewPost.missed
                      ? `Missed${viewPost.scheduled_at !== null ? ` · ${formatSchedule(viewPost.scheduled_at, timeZone)}` : ''}`
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
                    void (async () => {
                      const id = await editor.ensureId();
                      if (id === null) return;
                      try {
                        const response = await promotePosts.mutateAsync([id]);
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
              {!isNew && (viewPost.status === 'draft' || viewPost.status === 'official') && (
                <IconButton
                  label="Publish now"
                  icon={Send}
                  variant="default"
                  onClick={() => {
                    void (async () => {
                      const id = await editor.ensureId();
                      if (id === null) return;
                      const bad = readyChecks({
                        text: viewPost.text,
                        limit: viewPost.limit,
                        mediaCount: viewPost.media.length,
                        accountConnected: account.data?.account != null,
                      }).checks.find((check) => !check.ok);
                      if (bad) {
                        toast(bad.label, 'warn');
                        return;
                      }
                      setConfirm('publish');
                    })();
                  }}
                />
              )}
              {!isNew && viewPost.status === 'failed' && (
                <IconButton
                  label="Retry now"
                  icon={RefreshCw}
                  variant="primary"
                  onClick={() => setConfirm('retry')}
                />
              )}
              {!isNew && viewPost.status === 'published' && viewPost.x_post_url !== null && (
                <IconLink label="Open on X" icon={ExternalLink} href={viewPost.x_post_url} />
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
              <IconButton label="Close (Esc)" icon={X} variant="ghost" onClick={editor.close} />
            </div>
          </div>
          <div className="mbody">
            <div className="editor">
              {!isNew && viewPost.missed && (
                <div className="banner missed" role="status">
                  <TriangleAlert size={16} strokeWidth={1.75} />
                  {viewPost.status === 'draft'
                    ? 'Missed. Drafts are never sent. Pick a new time and promote, or clear the time.'
                    : 'Missed. No X account was connected at that time. Pick a new time, or clear the time.'}
                </div>
              )}
              {!isNew && viewPost.status === 'failed' && (
                <div className="banner failed" role="alert">
                  <TriangleAlert size={16} strokeWidth={1.75} />
                  <span>
                    <b>{viewPost.last_error}</b> after {viewPost.retry_count}{' '}
                    {viewPost.retry_count === 1 ? 'try' : 'tries'}. Retry now, or demote to move it
                    back to drafts.
                  </span>
                </div>
              )}
              {!isNew && viewPost.status === 'published' && (
                <div className="banner info" role="status">
                  <Check size={16} strokeWidth={1.75} />
                  Published. Text and images are read-only. Delete only removes it from Perch, not
                  from X.
                </div>
              )}
              <div className="field">
                <input
                  type="text"
                  className="ptitle"
                  aria-label="Title"
                  placeholder="Title, only shown in Perch"
                  readOnly={readOnly}
                  value={viewPost.title}
                  onChange={(event) => editor.setTitle(event.target.value)}
                />
                <textarea
                  ref={textareaRef}
                  className="ta"
                  aria-label="Text"
                  placeholder="What's happening?"
                  readOnly={readOnly}
                  value={viewPost.text}
                  onChange={(event) => editor.setText(event.target.value)}
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
                          onClick={() => void openDrawer('image')}
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
                      const postId = await editor.ensureId();
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
                        onClick={() => void openDrawer('all')}
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
                  disabled={tagPosts.isPending || untagPosts.isPending}
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
                    <b>This post has a link.</b> X bills it at{' '}
                    {formatCost(X_COSTS_USD.publishWithUrl)} instead of{' '}
                    {formatCost(X_COSTS_USD.publish)}.
                  </>
                ) : (
                  <>
                    <b>Cost rule.</b> A post is {formatCost(X_COSTS_USD.publish)}. Any http(s) link
                    makes it {formatCost(X_COSTS_USD.publishWithUrl)}. Images are free.
                  </>
                )}
              </div>
            </div>
            {parsedId !== null && (
              <ResourcesDrawer
                postId={parsedId}
                open={drawerOpen}
                initialType={drawerType}
                onClose={() => setDrawerOpen(false)}
                onNavigate={openResource}
                onInsertText={(inserted) => {
                  const text = editor.text;
                  const next = (text !== '' ? `${text}\n\n` : '') + inserted;
                  editor.setText(next);
                  textareaRef.current?.focus();
                }}
              />
            )}
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
          body={
            <p>
              Removes it from Perch. Linked resources are kept.
              {post.status === 'published' && (
                <>
                  {' '}
                  <b>The tweet stays on X.</b> Perch never deletes on X.
                </>
              )}
            </p>
          }
          ok="Delete"
          danger
          busy={deletePosts.isPending}
          onOk={() => void confirmDelete()}
          onCancel={() => setConfirm(null)}
        />
      )}
      {(confirm === 'publish' || confirm === 'retry') && post && currentId !== undefined && (
        <ConfirmDialog
          title={confirm === 'publish' ? 'Publish now?' : 'Retry now?'}
          body={
            <p>
              {post.status === 'draft' ? (
                <>
                  This draft becomes <b>official</b> and is sent
                </>
              ) : (
                'Sends'
              )}{' '}
              to X as <b>@{account.data?.account?.username}</b> right away. Cost{' '}
              <b>{formatCost(viewPost.estimated_cost)}</b>
              {hasUrl ? ' because the text has a link' : ''}.
              {viewPost.scheduled_at !== null ? ' The schedule time is cleared.' : ''}
            </p>
          }
          ok={confirm === 'publish' ? 'Publish' : 'Retry'}
          busy={confirm === 'publish' ? publishPost.isPending : retryPost.isPending}
          onOk={() => {
            const mutation = confirm === 'publish' ? publishPost : retryPost;
            void mutation
              .mutateAsync(currentId)
              .then(() => {
                setConfirm(null);
                toast('Published');
              })
              .catch((error: unknown) => {
                setConfirm(null);
                toast(errorMessage(error), 'warn');
              });
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}
