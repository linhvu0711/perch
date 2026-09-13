import { X } from 'lucide-react';
import { type JSX, type ReactNode, useEffect, useId } from 'react';

import { IconButton } from './IconButton';

export function ConfirmDialog(props: {
  title: string;
  body: ReactNode;
  ok: string;
  danger?: boolean;
  busy?: boolean;
  onOk(): void;
  onCancel(): void;
}): JSX.Element {
  const titleId = useId();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      props.onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [props]);

  return (
    <div
      className="scrim top"
      onMouseDown={(event) => event.target === event.currentTarget && props.onCancel()}
    >
      <div className="modal sm" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="mhead">
          <b id={titleId}>{props.title}</b>
          <div className="right">
            <IconButton label="Close" icon={X} variant="ghost" onClick={props.onCancel} />
          </div>
        </div>
        <div className="sbody confirm">{props.body}</div>
        <div className="sfoot">
          <button type="button" className="btn" onClick={props.onCancel} autoFocus>
            Cancel
          </button>
          <button
            type="button"
            className={props.danger ? 'btn danger solid' : 'btn primary'}
            disabled={props.busy}
            onClick={props.onOk}
          >
            {props.ok}
          </button>
        </div>
      </div>
    </div>
  );
}
