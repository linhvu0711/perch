import { useEffect, useId, useRef, useState, type JSX } from 'react';
import { IMAGE_BYTES_MAX, IMAGE_MIME_TYPES, RESOURCE_BATCH_MAX } from '@perch/core';
import { Upload, X } from 'lucide-react';

import { IconButton } from './IconButton';
import { toast } from './Toast';
import { errorMessage } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { useUploadImages } from '@/lib/queries';

interface ChosenFile {
  id: number;
  file: File;
  bad: string | null;
  outcome: 'pending' | 'uploaded' | string;
}

function precheck(file: File): string | null {
  if (file.size > IMAGE_BYTES_MAX) return 'Over 5 MB';
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
    return 'Only PNG, JPG, WebP, or GIF';
  }
  return null;
}

export function UploadImagesModal(props: {
  open: boolean;
  onClose(): void;
}): JSX.Element | null {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const [files, setFiles] = useState<ChosenFile[]>([]);
  const upload = useUploadImages();

  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      props.onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [props]);

  useEffect(() => {
    if (!props.open) setFiles([]);
  }, [props.open]);

  if (!props.open) return null;

  const addFiles = (incoming: Iterable<File>) => {
    setFiles((current) => {
      let readyCount = current.filter((entry) => entry.bad === null).length;
      const added = [...incoming].map((file) => {
        let bad = precheck(file);
        if (bad === null) {
          if (readyCount >= RESOURCE_BATCH_MAX) bad = 'At most 100 files';
          else readyCount += 1;
        }
        return {
          id: nextId.current++,
          file,
          bad,
          outcome: 'pending' as const,
        };
      });
      return [...current, ...added];
    });
  };

  const ready = files.filter(
    (entry) => entry.bad === null && entry.outcome === 'pending',
  );

  const onUpload = () => {
    const submitting = ready;
    upload.mutate(
      submitting.map((entry) => entry.file),
      {
        onSuccess: (data) => {
          const byId = new Map(
            submitting.map((entry, index) => [entry.id, data.results[index]]),
          );
          setFiles((current) =>
            current.map((entry) => {
              const result = byId.get(entry.id);
              if (!result) return entry;
              return {
                ...entry,
                outcome: result.ok ? ('uploaded' as const) : result.error.message,
              };
            }),
          );
          const ok = data.results.filter((r) => r.ok).length;
          if (ok > 0) {
            toast(`${ok} image${ok === 1 ? '' : 's'} uploaded`);
          }
          const submitted = new Set(submitting.map((entry) => entry.id));
          if (
            data.results.every((r) => r.ok) &&
            files.every(
              (entry) => entry.bad !== null || submitted.has(entry.id),
            )
          ) {
            props.onClose();
          }
        },
        onError: (error) => toast(errorMessage(error), 'warn'),
      },
    );
  };

  return (
    <div
      className="scrim top"
      onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}
    >
      <div
        className="modal sm"
        role="dialog"
        aria-modal="true"
        aria-label="Upload images"
        aria-labelledby={titleId}
      >
        <div className="mhead">
          <b id={titleId}>Upload images</b>
          <div className="right">
            <IconButton label="Close" icon={X} variant="ghost" onClick={props.onClose} />
          </div>
        </div>
        <div className="sbody">
          <div
            className="drop"
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              addFiles(event.dataTransfer.files);
            }}
          >
            <Upload size={20} strokeWidth={1.75} />
            <span>
              Drop images here or <b>choose files</b>
            </span>
            <small>PNG, JPG, WebP, GIF · 5 MB each · upload is free</small>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif"
            aria-label="Choose files"
            hidden
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              event.target.value = '';
            }}
          />
          {files.length > 0 && (
            <div className="files">
              {files.map((entry) => (
                <div className="file" key={entry.id}>
                  <span className="u">{entry.file.name}</span>
                  <span className="sz">{formatBytes(entry.file.size)}</span>
                  {entry.bad !== null ? (
                    <span className="error">{entry.bad}</span>
                  ) : entry.outcome === 'uploaded' ? (
                    <span>Uploaded</span>
                  ) : entry.outcome !== 'pending' ? (
                    <span className="error">{entry.outcome}</span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="sfoot">
          <button type="button" className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={upload.isPending || ready.length === 0}
            onClick={onUpload}
          >
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
