import type { Tag } from '@perch/core';
import { Plus, SquarePen, Tag as TagIcon, Trash2 } from 'lucide-react';
import { type JSX, useState } from 'react';

import { errorMessage } from '@/lib/api';
import { useCreateTag, useDeleteTags, useRenameTag, useTags } from '@/lib/queries';

import { ConfirmDialog } from './ConfirmDialog';
import { IconButton } from './IconButton';
import { toast } from './Toast';

export function TagSettings(): JSX.Element {
  const tags = useTags();
  const createTag = useCreateTag();
  const renameTag = useRenameTag();
  const deleteTags = useDeleteTags();

  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState<Tag | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirm, setConfirm] = useState<Tag | null>(null);

  const items = tags.data?.items ?? [];

  const create = () => {
    const name = draft.trim();
    if (name === '') return;
    void createTag
      .mutateAsync(name)
      .then(() => {
        setDraft('');
        toast('Tag created');
      })
      .catch((error: unknown) => toast(errorMessage(error), 'warn'));
  };

  const rename = () => {
    if (renaming === null) return;
    const name = renameDraft.trim();
    if (name === '' || name === renaming.name) {
      setRenaming(null);
      return;
    }
    void renameTag
      .mutateAsync({ id: renaming.id, name })
      .then(() => {
        setRenaming(null);
        toast(`Renamed to ${name}`);
      })
      .catch((error: unknown) => toast(errorMessage(error), 'warn'));
  };

  return (
    <>
      <h2>
        Tags<small>{items.length} · shared by posts and resources</small>
      </h2>
      <div className="card">
        <div className="newrow">
          <TagIcon size={16} strokeWidth={1.75} />
          <input
            aria-label="New tag name"
            placeholder="New tag name, Enter to create"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') create();
            }}
          />
          <IconButton label="Create tag" icon={Plus} size="sm" onClick={create} />
        </div>
        <table className="t">
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="note">
                  No tags yet
                </td>
              </tr>
            ) : (
              items.map((tag) => (
                <tr key={tag.id}>
                  <td>
                    {renaming?.id === tag.id ? (
                      <input
                        aria-label="Tag name"
                        // biome-ignore lint/a11y/noAutofocus: inline rename field takes focus on open
                        autoFocus
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') rename();
                          if (event.key === 'Escape') setRenaming(null);
                        }}
                      />
                    ) : (
                      tag.name
                    )}
                  </td>
                  <td className="num">{tag.resource_count} res</td>
                  <td className="num">{tag.post_count} posts</td>
                  <td style={{ width: '1%' }}>
                    <div className="acts">
                      <IconButton
                        label="Rename"
                        icon={SquarePen}
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRenaming(tag);
                          setRenameDraft(tag.name);
                        }}
                      />
                      <IconButton
                        label="Delete"
                        icon={Trash2}
                        variant="ghost"
                        size="sm"
                        className="danger"
                        onClick={() => setConfirm(tag)}
                      />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {confirm !== null && (
          <ConfirmDialog
            title={`Delete tag "${confirm.name}"?`}
            body={
              <p>
                It is removed from <b>{confirm.resource_count} resources</b> and{' '}
                <b>{confirm.post_count} posts</b>. They are not deleted.
              </p>
            }
            ok="Delete tag"
            danger
            busy={deleteTags.isPending}
            onOk={() =>
              void deleteTags
                .mutateAsync([confirm.id])
                .then(() => {
                  setConfirm(null);
                  toast('Tag deleted');
                })
                .catch((error: unknown) => toast(errorMessage(error), 'warn'))
            }
            onCancel={() => setConfirm(null)}
          />
        )}
      </div>
    </>
  );
}
