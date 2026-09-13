import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { firstMarkdownHeading, noteTitle } from '@perch/core';
import { Check, CopyPlus, FileText, Image, Pencil, PenLine, Trash2, Undo2, X } from 'lucide-react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';

import { ApiError, errorMessage } from '@/lib/api';
import { formatBytes, formatDateTime, wordCount } from '@/lib/format';
import {
  useCreateNote,
  useCreatePost,
  useDeleteResources,
  usePosts,
  useResource,
  useUpdateResource,
} from '@/lib/queries';

import { StatusPill } from './StatusPill';

import { ConfirmDialog } from './ConfirmDialog';
import { IconButton } from './IconButton';
import { Markdown } from './Markdown';
import { NoteEditor } from './NoteEditor';
import { toast } from './Toast';

type ConfirmState =
  | 'discard-edit'
  | 'discard-close'
  | 'discard-navigation'
  | 'delete'
  | null;

export function ResourceModal(): JSX.Element | null {
  const { id: idValue } = useParams();
  const navigate = useNavigate();
  const isNew = idValue === 'new';
  const parsedId =
    !isNew && idValue !== undefined && /^\d+$/.test(idValue) && Number(idValue) > 0
      ? Number(idValue)
      : null;
  const invalidId = !isNew && parsedId === null;
  const resourceQuery = useResource(isNew || invalidId ? null : parsedId);
  const createNote = useCreateNote();
  const createPost = useCreatePost();
  const usedBy = usePosts(
    parsedId === null ? { resource_id: -1 } : { resource_id: parsedId },
  );
  const usedByPosts =
    parsedId === null
      ? []
      : (usedBy.data?.pages.flatMap((page) => page.items) ?? []);
  const usedByTotal =
    parsedId === null ? 0 : (usedBy.data?.pages[0]?.total ?? usedByPosts.length);
  const updateResource = useUpdateResource();
  const deleteResources = useDeleteResources();
  const modalRef = useRef<HTMLDivElement>(null);
  const allowNavigationRef = useRef(false);
  const [isEditing, setIsEditing] = useState(isNew);
  const [bodyDraft, setBodyDraft] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const resource = resourceQuery.data;
  const resourceId = resource?.id;
  const saving = createNote.isPending || updateResource.isPending;
  const original = isNew
    ? { body: '', title: '' }
    : { body: resource?.type === 'md' ? resource.body : '', title: resource?.title ?? '' };
  const notesDirty = !isNew && resource !== undefined && notesDraft !== resource.notes;
  const dirty =
    isEditing &&
    (bodyDraft !== original.body ||
      titleDraft !== original.title ||
      (isNew && notesDraft !== ''));
  const blocker = useBlocker(
    () => (dirty || notesDirty) && !allowNavigationRef.current,
  );

  useEffect(() => {
    if (invalidId) navigate('/resources', { replace: true });
  }, [invalidId, navigate]);

  useEffect(() => {
    if (
      resourceQuery.error instanceof ApiError &&
      resourceQuery.error.status === 404
    ) {
      toast('Resource not found', 'warn');
      navigate('/resources', { replace: true });
    }
  }, [navigate, resourceQuery.error]);

  useEffect(() => {
    if (!resource || isEditing) return;
    setBodyDraft(resource.type === 'md' ? resource.body : '');
    setTitleDraft(resource.title);
    setTitleTouched(false);
    setNotesDraft(resource.notes);
  }, [isEditing, resource]);

  useEffect(() => {
    if (!isEditing) modalRef.current?.focus();
  }, [isEditing, resourceId]);

  const resetDrafts = useCallback(() => {
    if (!resource) return;
    setBodyDraft(resource.type === 'md' ? resource.body : '');
    setTitleDraft(resource.title);
    setTitleTouched(false);
    setNotesDraft(resource.notes);
  }, [resource]);

  const saveNotes = useCallback(async (): Promise<boolean> => {
    if (isNew || parsedId === null || !resource || notesDraft === resource.notes) {
      return true;
    }
    try {
      await updateResource.mutateAsync({ id: parsedId, patch: { notes: notesDraft } });
      toast('Notes saved');
      return true;
    } catch (error) {
      toast(errorMessage(error), 'warn');
      setNotesDraft(resource.notes);
      return false;
    }
  }, [isNew, notesDraft, parsedId, resource, updateResource]);

  const requestClose = useCallback(() => {
    if (dirty) {
      setConfirm('discard-close');
    } else if (notesDirty) {
      void saveNotes().then((saved) => {
        if (!saved) return;
        allowNavigationRef.current = true;
        navigate('/resources');
      });
    } else {
      navigate('/resources');
    }
  }, [dirty, navigate, notesDirty, saveNotes]);

  const cancelConfirm = useCallback(() => {
    if (confirm === 'discard-navigation' && blocker.state === 'blocked') {
      blocker.reset();
    }
    setConfirm(null);
  }, [blocker, confirm]);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const { proceed, reset } = blocker;
    if (dirty) {
      setConfirm('discard-navigation');
      return;
    }
    void saveNotes().then((saved) => {
      if (saved) proceed();
      else reset();
    });
  }, [blocker.state, dirty, saveNotes]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (confirm !== null) {
        cancelConfirm();
        return;
      }
      requestClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [cancelConfirm, confirm, requestClose]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  if (invalidId) return null;

  function startEditing(): void {
    resetDrafts();
    setIsEditing(true);
  }

  function changeBody(body: string): void {
    setBodyDraft(body);
    if (!titleTouched) {
      setTitleDraft(firstMarkdownHeading(body) ?? (isNew ? '' : resource?.title ?? ''));
    }
  }

  async function save(): Promise<void> {
    if (saving) return;
    const isImage = !isNew && resource?.type === 'image';
    const title = isImage ? titleDraft : noteTitle(bodyDraft, titleDraft);
    try {
      if (isNew) {
        const data = await createNote.mutateAsync({
          title,
          notes: notesDraft,
          body: bodyDraft,
        });
        toast('Note created');
        setIsEditing(false);
        allowNavigationRef.current = true;
        navigate(`/resources/${data.id}`, { replace: true });
      } else if (parsedId !== null) {
        await updateResource.mutateAsync({
          id: parsedId,
          patch: isImage ? { title } : { title, body: bodyDraft },
        });
        toast(isImage ? 'Image saved' : 'Note saved');
        setIsEditing(false);
      }
    } catch (error) {
      toast(errorMessage(error), 'warn');
    }
  }

  function requestDiscard(): void {
    if (dirty) {
      setConfirm('discard-edit');
    } else if (isNew) {
      navigate('/resources');
    } else {
      resetDrafts();
      setIsEditing(false);
    }
  }

  function confirmDiscard(): void {
    const close = confirm === 'discard-close';
    const navigation = confirm === 'discard-navigation';
    setConfirm(null);
    if (navigation && blocker.state === 'blocked') {
      blocker.proceed();
      return;
    }
    if (close || isNew) {
      allowNavigationRef.current = true;
      navigate('/resources');
      return;
    }
    resetDrafts();
    setIsEditing(false);
  }

  async function confirmDelete(): Promise<void> {
    if (parsedId === null) return;
    try {
      const response = await deleteResources.mutateAsync([parsedId]);
      const result = response.results[0];
      if (result?.ok) {
        allowNavigationRef.current = true;
        navigate('/resources');
        toast(
          result.unlinked_post_ids.length > 0
            ? `Deleted. Unlinked from ${result.unlinked_post_ids.map((id) => `#${id}`).join(', ')}`
            : 'Deleted',
        );
      } else if (result && !result.ok) {
        toast(result.error.message, 'warn');
        setConfirm(null);
      }
    } catch (error) {
      toast(errorMessage(error), 'warn');
      setConfirm(null);
    }
  }

  if (!isNew && resourceQuery.isPending) {
    return (
      <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
        <div className="modal" role="dialog" aria-modal="true" aria-label="Note" tabIndex={-1} ref={modalRef}>
          <div className="mhead">
            <span className="id">#{parsedId}</span>
            <span className="kind"><FileText />Note</span>
            <div className="right">
              <IconButton label="Close (Esc)" icon={X} variant="ghost" onClick={requestClose} />
            </div>
          </div>
          <div className="rbody"><div className="rmain"><div className="muted">Loading…</div></div></div>
        </div>
      </div>
    );
  }

  if (!isNew && resourceQuery.isError && !(resourceQuery.error instanceof ApiError && resourceQuery.error.status === 404)) {
    return (
      <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
        <div className="modal" role="dialog" aria-modal="true" aria-label="Note" tabIndex={-1} ref={modalRef}>
          <div className="mhead">
            <span className="id">#{parsedId}</span>
            <span className="kind"><FileText />Note</span>
            <div className="right">
              <IconButton label="Close (Esc)" icon={X} variant="ghost" onClick={requestClose} />
            </div>
          </div>
          <div className="rbody"><div className="rmain"><div className="muted">{errorMessage(resourceQuery.error)}</div></div></div>
        </div>
      </div>
    );
  }

  if (!isNew && !resource) return null;

  const isImage = resource?.type === 'image';
  const displayedBody = isEditing ? bodyDraft : resource?.type === 'md' ? resource.body : '';
  const displayedTitle = isEditing ? titleDraft : resource?.title ?? '';
  const editingNote = isEditing && resource?.type === 'md';

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
          aria-label={displayedTitle || (isImage ? 'Image' : 'Note')}
          tabIndex={-1}
          ref={modalRef}
        >
          <div className="mhead">
            <span className="id">{isNew ? 'new' : `#${parsedId}`}</span>
            <span className="kind">
              {isImage ? (
                <>
                  <Image />
                  Image
                </>
              ) : (
                <>
                  <FileText />
                  Note
                </>
              )}
            </span>
            {isEditing ? (
              <input
                className="rtitle"
                aria-label="Title"
                placeholder="Untitled"
                value={titleDraft}
                onChange={(event) => {
                  setTitleTouched(true);
                  setTitleDraft(event.target.value);
                }}
              />
            ) : (
              <b>{resource?.title}</b>
            )}
            <div className="right">
              {isEditing ? (
                <>
                  <IconButton
                    label="Discard changes"
                    icon={Undo2}
                    variant="ghost"
                    size="sm"
                    className="danger"
                    onClick={requestDiscard}
                  />
                  <IconButton
                    label={isImage ? 'Save image' : 'Save note'}
                    icon={Check}
                    variant="primary"
                    size="sm"
                    disabled={saving}
                    onClick={() => void save()}
                  />
                  <IconButton label="Close (Esc)" icon={X} variant="ghost" onClick={requestClose} />
                </>
              ) : (
                <>
                  <IconButton
                    label={isImage ? 'Edit title' : 'Edit note'}
                    icon={Pencil}
                    size="sm"
                    onClick={startEditing}
                  />
                  {!isNew && (
                    <IconButton
                      label="New draft from this"
                      icon={CopyPlus}
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        if (parsedId === null) return;
                        void createPost
                          .mutateAsync({ from: [parsedId] })
                          .then((created) => {
                            toast('Draft created');
                            navigate(`/posts/${created.id}`);
                          })
                          .catch((error: unknown) =>
                            toast(errorMessage(error), 'warn'),
                          );
                      }}
                    />
                  )}
                  <IconButton
                    label="Delete resource"
                    icon={Trash2}
                    variant="ghost"
                    size="sm"
                    className="danger"
                    onClick={() => setConfirm('delete')}
                  />
                  <IconButton label="Close (Esc)" icon={X} variant="ghost" onClick={requestClose} />
                </>
              )}
            </div>
          </div>
          <div className="rbody">
            <div
              className={editingNote ? 'rmain editing' : 'rmain'}
              onKeyDown={(event) => {
                if (isEditing && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void save();
                }
              }}
            >
              {isImage ? (
                <img
                  className="bigimg"
                  src={`/api/resources/${parsedId}/file`}
                  alt={displayedTitle}
                />
              ) : editingNote ? (
                <NoteEditor body={bodyDraft} onChange={changeBody} />
              ) : displayedBody === '' ? (
                <div className="muted">Empty note.</div>
              ) : (
                <Markdown body={displayedBody} />
              )}
            </div>
            <div className="rside">
              <div className="field">
                <label>Details</label>
                <div className="kv">
                  {isImage ? (
                    <>
                      <b>File</b><span>{resource.title}</span>
                      <b>Size</b><span>{formatBytes(resource.bytes)}</span>
                      <b>Pixels</b><span>{resource.width} × {resource.height}</span>
                      <b>Type</b><span>{resource.mime}</span>
                    </>
                  ) : (
                    <b>Words</b>
                  )}
                  {!isImage && <span>{wordCount(displayedBody)}</span>}
                  <b>Saved</b><span>{isNew ? '—' : formatDateTime(resource!.created_at)}</span>
                </div>
              </div>
              {!isNew && (
                <div className="field">
                  <label>
                    Used by {usedByTotal} post{usedByTotal === 1 ? '' : 's'}
                  </label>
                  <div className="linked">
                    {usedByPosts.length === 0 ? (
                      <span className="note">Not linked to any post yet.</span>
                    ) : (
                      usedByPosts.map((post) => (
                        <Link
                          key={post.id}
                          to={`/posts/${post.id}`}
                          className="link"
                        >
                          <span className="k">
                            <PenLine size={14} strokeWidth={1.75} />
                          </span>
                          <span className="ltitle">
                            #{post.id} · {post.title || 'Empty post'}
                          </span>
                          <StatusPill status={post.status} />
                        </Link>
                      ))
                    )}
                    {usedByTotal > usedByPosts.length && (
                      <span className="note">
                        …and {usedByTotal - usedByPosts.length} more
                      </span>
                    )}
                  </div>
                </div>
              )}
              <div className="field">
                <label>Private notes</label>
                <textarea
                  aria-label="Private notes"
                  placeholder="Why you saved this"
                  value={notesDraft}
                  onChange={(event) => setNotesDraft(event.target.value)}
                  onBlur={() => void saveNotes()}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      {(confirm === 'discard-edit' ||
        confirm === 'discard-close' ||
        confirm === 'discard-navigation') && (
        <ConfirmDialog
          title="Discard changes?"
          body={<p>Your edits to this note will be lost.</p>}
          ok="Discard"
          danger
          onOk={confirmDiscard}
          onCancel={cancelConfirm}
        />
      )}
      {confirm === 'delete' && resource && (
        <ConfirmDialog
          title={`Delete ${resource.title}?`}
          body={
            usedByTotal > 0 ? (
              <p>
                It is unlinked from {usedByTotal} post
                {usedByTotal === 1 ? '' : 's'} (
                {usedByPosts.map((post) => `#${post.id}`).join(', ')}
                {usedByTotal > usedByPosts.length ? ', …' : ''}).
              </p>
            ) : (
              <p>It is not used by any post.</p>
            )
          }
          ok="Delete"
          danger
          busy={deleteResources.isPending}
          onOk={() => void confirmDelete()}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}
