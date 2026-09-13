import type { PostStatus } from '@perch/core';

export function StatusPill({ status }: { status: PostStatus | 'missed' }) {
  return <span className={`pill ${status}`}>{status}</span>;
}
