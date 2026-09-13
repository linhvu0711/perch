import type { PostStatus } from '@perch/core';

export function StatusPill({ status }: { status: PostStatus }) {
  return <span className={`pill ${status}`}>{status}</span>;
}
