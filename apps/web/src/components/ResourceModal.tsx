import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { firstMarkdownHeading, noteTitle } from '@perch/core';
import { Check, FileText, Pencil, Trash2, Undo2, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';

import { ApiError, errorMessage } from '@/lib/api';
import { formatDateTime, wordCount } from '@/lib/format';
import {
  useCreateNote,
  useDeleteResources,
  useResource,
  useUpdateResource,
} from '@/lib/queries';

import { ConfirmDialog } from './ConfirmDialog';
import { IconButton } from './IconButton';
import { Markdown } from './Markdown';
import { NoteEditor } from './NoteEditor';
import { toast } from './Toast';

type ConfirmState = 'discard-edit' | 'discard-close' | 'delete' | null;

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
  const updateResource = useUpdateResource();
  const deleteResources = useDeleteResources();
  const modalRef = useRef<HTMLDivElement>(null);
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
    : { body: resource?.body ?? '', title: resource?.title ?? '' };
  const dirty =
    isEditing &&
    (bodyDraft !== original.body ||
      titleDraft !== original.title ||
      (isNew && notesDraft !== ''));

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
    setBodyDraft(resource.body);
    setTitleDraft(resource.title);
    setTitleTouched(false);
    setNotesDraft(resource.notes);
  }, [isEditing, resource]);

  useEffect(() => {
    if (!isEditing) modalRef.current?.focus();
  }, [isEditing, resourceId]);

  const resetDrafts = useCallback(() => {
    if (!resource) return;
    setBodyDraft(resource.body);
    setTitleDraft(resource.title);
    setTitleTouched(false);
    setNotesDraft(resource.notes);
  }, [resource]);

  const requestClose = useCallback(() => {
    if (dirty) {
      setConfirm('discard-close');
    } else {
      navigate('/resources');
    }
  }, [dirty, navigate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (confirm !== null) {
        setConfirm(null);
        return;
      }
      requestClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirm, requestClose]);

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
    const title = noteTitle(bodyDraft, titleDraft);
    try {
      if (isNew) {
        const data = await createNote.mutateAsync({
          title,
          notes: notesDraft,
          body: bodyDraft,
        });
        toast('Note created');
        setIsEditing(false);
        navigate(`/resources/${data.id}`, { replace: true });
      } else if (parsedId !== null) {
        await updateResource.mutateAsync({
          id: parsedId,
          patch: { title, body: bodyDraft },
        });
        toast('Note saved');
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
    setConfirm(null);
    if (close || isNew) {
      navigate('/resources');
      return;
    }
    resetDrafts();
    setIsEditing(false);
  }

  async function saveNotes(): Promise<void> {
    if (isNew || parsedId === null || !resource || notesDraft === resource.notes) return;
    try {
      await updateResource.mutateAsync({ id: parsedId, patch: { notes: notesDraft } });
      toast('Notes saved');
    } catch (error) {
      toast(errorMessage(error), 'warn');
      setNotesDraft(resource.notes);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (parsedId === null) return;
    try {
      const response = await deleteResources.mutateAsync([parsedId]);
      const result = response.results[0];
      if (result?.ok) {
        toast('Deleted');
        navigate('/resources');
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

  const displayedBody = isEditing ? bodyDraft : resource?.body ?? '';
  const displayedTitle = isEditing ? titleDraft : resource?.title ?? '';

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
          aria-label={displayedTitle || 'Note'}
          tabIndex={-1}
          ref={modalRef}
        >
          <div className="mhead">
            <span className="id">{isNew ? 'new' : `#${parsedId}`}</span>
            <span className="kind"><FileText />Note</span>
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
                    label="Save note"
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
                  <IconButton label="Edit note" icon={Pencil} size="sm" onClick={startEditing} />
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
              className={isEditing ? 'rmain editing' : 'rmain'}
              onKeyDown={(event) => {
                if (isEditing && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void save();
                }
              }}
            >
              {isEditing ? (
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
                  <b>Words</b><span>{wordCount(displayedBody)}</span>
                  <b>Saved</b><span>{isNew ? '—' : formatDateTime(resource!.created_at)}</span>
                  <b>Used in</b><span>0 posts</span>
                </div>
              </div>
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
      {(confirm === 'discard-edit' || confirm === 'discard-close') && (
        <ConfirmDialog
          title="Discard changes?"
          body={<p>Your edits to this note will be lost.</p>}
          ok="Discard"
          danger
          onOk={confirmDiscard}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'delete' && resource && (
        <ConfirmDialog
          title={`Delete ${resource.title}?`}
          body={<p>It is not used by any post.</p>}
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
