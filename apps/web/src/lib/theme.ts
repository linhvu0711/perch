import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'system';

const listeners = new Set<() => void>();
let current: Theme = readTheme();

export function readTheme(): Theme {
  try {
    const value = localStorage.getItem('perch-theme');
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.remove('light', 'dark');
  if (theme !== 'system') document.documentElement.classList.add(theme);
  try {
    localStorage.setItem('perch-theme', theme);
  } catch {
    // Theme still applies for this page when storage is unavailable.
  }
  current = theme;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore<Theme>(
    subscribe,
    () => current,
    () => 'system',
  );
  return [theme, applyTheme];
}
