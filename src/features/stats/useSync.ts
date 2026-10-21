import { useSyncExternalStore } from 'react';

import { getSyncState, subscribeSync, type SyncState } from './sync.ts';

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribeSync, getSyncState, getSyncState);
}

/** «hace 5 min», «hace 2 h»… a partir de una fecha ISO. */
export function ago(iso: string | null, now: number = Date.now()): string {
  if (iso === null) return 'nunca';
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${String(minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `hace ${String(hours)} h`;
  return `hace ${String(Math.round(hours / 24))} días`;
}
