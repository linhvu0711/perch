import type { JSX } from 'react';

export function TagChips({ tags }: { tags: string[] }): JSX.Element | null {
  if (tags.length === 0) return null;
  return (
    <div className="tags">
      {tags.map((tag) => (
        <span key={tag} className="tag">
          {tag}
        </span>
      ))}
    </div>
  );
}
