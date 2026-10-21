import { useSyncExternalStore } from 'react';

import { readJson, writeJson } from '../../data/cache.ts';
import { MAX_PUBLICATIONS, mergePublications, sortMeasurements, toPublications, type Measurement, type Publication } from './model.ts';

const KEY = 'stats';
const isArray = (v: unknown): v is unknown[] => Array.isArray(v);

function readStored(): readonly Publication[] {
  try {
    return toPublications(readJson(KEY, isArray));
  } catch (error) {
    console.warn('No se pudieron leer las estadísticas guardadas', error);
    return [];
  }
}

/** Publicaciones y mediciones. Se guardan sólo en el navegador (localStorage). */
let current: readonly Publication[] = readStored();
const listeners = new Set<() => void>();

/** Devuelve `null` si se guardó bien o el mensaje de error si no cupo (los datos siguen en memoria hasta recargar). */
function commit(next: readonly Publication[]): string | null {
  current = next.slice(0, MAX_PUBLICATIONS);
  let problem: string | null = null;
  try {
    writeJson(KEY, current);
  } catch (error) {
    console.warn('No se pudieron guardar las estadísticas', error);
    problem = error instanceof Error ? error.message : 'No se pudo guardar en el navegador.';
  }
  for (const l of listeners) l();
  return problem;
}

export const getPublications = (): readonly Publication[] => current;

export function subscribeStats(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePublications(): readonly Publication[] {
  return useSyncExternalStore(subscribeStats, getPublications, getPublications);
}

/** Crea o fusiona (por id) una publicación. */
export function savePublication(pub: Publication): string | null {
  return commit(mergePublications(current, [pub]));
}

/** Reemplaza una publicación existente (p. ej. tras editarla); si cambió de enlace, cambia su id. */
export function replacePublication(oldId: string, pub: Publication): string | null {
  return commit(mergePublications(current.filter((p) => p.id !== oldId), [pub]));
}

export function addMeasurement(id: string, m: Measurement): string | null {
  return commit(current.map((p) => (p.id === id ? { ...p, measurements: sortMeasurements([...p.measurements, m]) } : p)));
}

export function deleteMeasurement(id: string, date: string): string | null {
  return commit(current.map((p) => (p.id === id ? { ...p, measurements: p.measurements.filter((m) => m.date !== date) } : p)));
}

export function removePublication(id: string): void {
  commit(current.filter((p) => p.id !== id));
}

/** Fusiona lo importado con lo que ya hay. */
export function importPublications(incoming: readonly Publication[]): string | null {
  return commit(mergePublications(current, incoming));
}

/** Sustituye todas las publicaciones (al recibir cambios de otro dispositivo). */
export function replacePublications(pubs: readonly Publication[]): string | null {
  return commit(pubs);
}

/** Sólo para pruebas. */
export function resetStatsForTests(pubs: readonly Publication[] = []): void {
  current = pubs;
  for (const l of listeners) l();
}
