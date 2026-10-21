import { useSyncExternalStore } from 'react';

import { readJson, writeJson } from '../../data/cache.ts';

/**
 * Vídeos que el usuario marca a mano como PUBLICADOS (por id de ficha), con la fecha en que los marcó (`YYYY-MM-DD`, hora local).
 * Sólo sirve para llevar un orden: no se conecta con TikTok ni Instagram. Se guarda en el navegador (localStorage).
 */
const KEY = 'published-videos';

export type PublishedMap = Readonly<Record<string, string>>;

const isMap = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));

function readStored(): PublishedMap {
  try {
    return readJson(KEY, isMap) ?? {};
  } catch (error) {
    console.warn('No se pudieron leer los vídeos publicados', error);
    return {};
  }
}

let current: PublishedMap = readStored();
const listeners = new Set<() => void>();

const localToday = (): string => {
  const d = new Date();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function commit(next: PublishedMap): void {
  current = next;
  try {
    writeJson(KEY, next);
  } catch (error) {
    console.warn('No se pudo guardar la marca de publicado', error);
  }
  for (const l of listeners) l();
}

export const getPublished = (): PublishedMap => current;

export function subscribePublished(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePublished(): PublishedMap {
  return useSyncExternalStore(subscribePublished, getPublished, getPublished);
}

/** Marca como publicado (con la fecha de hoy, o la indicada) o quita la marca si ya lo estaba. */
export function togglePublished(videoId: string, date: string = localToday()): void {
  if (videoId in current) commit(Object.fromEntries(Object.entries(current).filter(([id]) => id !== videoId)));
  else commit({ ...current, [videoId]: date });
}

/** Sólo para pruebas. */
export function resetPublishedForTests(map: PublishedMap = {}): void {
  current = map;
  for (const l of listeners) l();
}
