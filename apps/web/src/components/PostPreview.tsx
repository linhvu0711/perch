import { useState } from 'react';
import { foldPreview, previewSegments } from '@perch/core';
import type { Post } from '@perch/core';

function Segments({ text }: { text: string }) {
  const segments = previewSegments(text);
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <span key={index} className="xc blue">
            {segment.text}
          </span>
        ),
      )}
    </>
  );
}

export function PostPreview({ post }: { post: Post }) {
  const [expanded, setExpanded] = useState(false);
  const fold = foldPreview(post.text);
  const visible = expanded ? post.text : fold.visible;
  const paragraphs = visible.split('\n\n');

  return (
    <div className="xcard">
      <div className="av" />
      <div>
        <div className="name">
          <b>You</b>
          <span>@you · {post.scheduled_at ? 'scheduled' : 'now'}</span>
        </div>
        <div className="text">
          {post.text === '' ? (
            <span className="faint">Nothing yet.</span>
          ) : (
            <>
              {paragraphs.map((paragraph, index) => (
                <p key={index}>
                  <Segments text={paragraph} />
                  {!expanded && fold.folded && index === paragraphs.length - 1
                    ? '…'
                    : ''}
                </p>
              ))}
              {fold.folded && (
                <button
                  type="button"
                  className="more"
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </>
          )}
        </div>
        <div className="meta">
          {post.scheduled_at
            ? new Date(post.scheduled_at).toLocaleString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            : 'Not scheduled'}
        </div>
      </div>
    </div>
  );
}
