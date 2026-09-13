import { type JSX, useEffect } from 'react';

export function Lightbox(props: { src: string; caption: string; onClose(): void }): JSX.Element {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      props.onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [props]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: dialog closes on any click; Escape is handled on document
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={props.caption}
      onClick={props.onClose}
    >
      <img className="img" src={props.src} alt={props.caption} />
      <div className="cap">{props.caption} · click anywhere to close</div>
    </div>
  );
}
