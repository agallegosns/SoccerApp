import { readJson, writeJson } from './cache.ts';

const KEY = 'downloaded';

const isIdList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * Partidos «hechos» (por id): los de los que se ha descargado algún vídeo y los que el usuario marca a mano. Se guarda sólo en el navegador (localStorage)
 * y avisa a los suscriptores al cambiar, para que el calendario pinte de verde la tarjeta sin recargar.
 */
let current: ReadonlySet<string> = new Set(readStored());
const listeners = new Set<() => void>();

function readStored(): string[] {
  try {
    return readJson(KEY, isIdList) ?? [];
  } catch (error) {
    console.warn('No se pudieron leer las descargas guardadas', error);
    return [];
  }
}

export function getDownloaded(): ReadonlySet<string> {
  return current;
}

export function subscribeDownloaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Marca un partido como descargado. Si no se puede guardar (almacenamiento lleno o bloqueado) sigue marcado hasta recargar. */
export function markDownloaded(matchId: string): void {
  if (current.has(matchId)) return;
  current = new Set([...current, matchId]);
  try {
    writeJson(KEY, [...current]);
  } catch (error) {
    console.warn('No se pudo recordar la descarga', error);
  }
  for (const l of listeners) l();
}

/** Quita la marca (p. ej. si se marcó por error). */
export function unmarkDownloaded(matchId: string): void {
  if (!current.has(matchId)) return;
  current = new Set([...current].filter((id) => id !== matchId));
  try {
    writeJson(KEY, [...current]);
  } catch (error) {
    console.warn('No se pudo guardar el cambio', error);
  }
  for (const l of listeners) l();
}

/** Marca o desmarca a mano un partido que ya has hecho por tu cuenta. */
export function toggleDownloaded(matchId: string): void {
  if (current.has(matchId)) unmarkDownloaded(matchId);
  else markDownloaded(matchId);
}

/** Sólo para pruebas: reinicia el estado en memoria. */
export function resetDownloadedForTests(ids: readonly string[] = []): void {
  current = new Set(ids);
  for (const l of listeners) l();
}
