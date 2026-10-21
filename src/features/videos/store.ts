import { useSyncExternalStore } from 'react';

import { readJson, writeJson } from '../../data/cache.ts';
import { MAX_VIDEOS, toVideoRecords, type VideoRecord } from './model.ts';

const KEY = 'videos';
const isArray = (v: unknown): v is unknown[] => Array.isArray(v);

function readStored(): readonly VideoRecord[] {
  try {
    return toVideoRecords(readJson(KEY, isArray));
  } catch (error) {
    console.warn('No se pudieron leer las fichas de vídeo guardadas', error);
    return [];
  }
}

/** Fichas de los vídeos exportados (más recientes primero). Se guardan sólo en el navegador (localStorage). */
let current: readonly VideoRecord[] = readStored();
const listeners = new Set<() => void>();

function commit(next: readonly VideoRecord[]): void {
  current = next.slice(0, MAX_VIDEOS);
  try {
    writeJson(KEY, current);
  } catch (error) {
    console.warn('No se pudieron guardar las fichas de vídeo', error);
  }
  for (const l of listeners) l();
}

export const getVideos = (): readonly VideoRecord[] => current;

export function subscribeVideos(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useVideos(): readonly VideoRecord[] {
  return useSyncExternalStore(subscribeVideos, getVideos, getVideos);
}

/** Crea la ficha o, si ya existía una con los mismos parámetros, la actualiza y la sube al principio. */
export function upsertVideo(record: VideoRecord): void {
  commit([record, ...current.filter((v) => v.id !== record.id)]);
}

export function removeVideo(id: string): void {
  if (current.some((v) => v.id === id)) commit(current.filter((v) => v.id !== id));
}

/** Sólo para pruebas. */
export function resetVideosForTests(records: readonly VideoRecord[] = []): void {
  current = records;
  for (const l of listeners) l();
}
