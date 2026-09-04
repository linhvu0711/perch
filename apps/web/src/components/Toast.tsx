import { useSyncExternalStore } from 'react';
import { Check, TriangleAlert } from 'lucide-react';

type ToastValue = { message: string; icon: 'check' | 'warn'; id: number } | null;

let value: ToastValue = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function toast(message: string, icon: 'check' | 'warn' = 'check'): void {
  if (timer) clearTimeout(timer);
  value = { message, icon, id: nextId++ };
  emit();
  timer = setTimeout(() => {
    value = null;
    emit();
  }, 2600);
}

export function Toaster() {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => value,
    () => null,
  );
  if (!current) return null;
  const Icon = current.icon === 'check' ? Check : TriangleAlert;
  return (
    <div className="toast" role="status" aria-live="polite" key={current.id}>
      <Icon size={16} strokeWidth={1.75} />
      {current.message}
    </div>
  );
}
