import { readJson, writeJson } from './cache.ts';

const KEY = 'downloaded';

const isIdList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * Partidos de los que el usuario ya ha descargado algún vídeo (por id de partido). Se guarda sólo en el navegador (localStorage)
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

/** Sólo para pruebas: reinicia el estado en memoria. */
export function resetDownloadedForTests(ids: readonly string[] = []): void {
  current = new Set(ids);
  for (const l of listeners) l();
}
