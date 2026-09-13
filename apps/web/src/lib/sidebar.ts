import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();

function readCollapsed(): boolean {
  try {
    return localStorage.getItem('perch-side') === '1';
  } catch {
    return false;
  }
}

let current = readCollapsed();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setCollapsed(value: boolean): void {
  current = value;
  try {
    localStorage.setItem('perch-side', value ? '1' : '0');
  } catch {
    // Collapse still applies for this page when storage is unavailable.
  }
  for (const listener of listeners) listener();
}

export function useSidebarCollapsed(): [boolean, (value: boolean) => void] {
  const collapsed = useSyncExternalStore(
    subscribe,
    () => current,
    () => false,
  );
  return [collapsed, setCollapsed];
}
