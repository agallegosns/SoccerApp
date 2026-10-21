import { useSyncExternalStore } from 'react';

import { readJson, writeJson } from '../../data/cache.ts';

/**
 * Vídeos que el usuario ha PROGRAMADO a mano en TikTok/Instagram (por id de ficha) y la hora a la que los programó
 * (`YYYY-MM-DDTHH:mm`, hora local del dispositivo). La app no programa nada en las plataformas: sólo recuerda la hora
 * para llevar el orden y avisar cuando llega para confirmar si ya se ha publicado. Se guarda en el navegador (localStorage).
 */
const KEY = 'scheduled-videos';

export type ScheduledMap = Readonly<Record<string, string>>;

export const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const isMap = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((d) => typeof d === 'string' && LOCAL_DATETIME.test(d));

function readStored(): ScheduledMap {
  try {
    return readJson(KEY, isMap) ?? {};
  } catch (error) {
    console.warn('No se pudieron leer los vídeos programados', error);
    return {};
  }
}

let current: ScheduledMap = readStored();
const listeners = new Set<() => void>();

function commit(next: ScheduledMap): void {
  current = next;
  try {
    writeJson(KEY, next);
  } catch (error) {
    console.warn('No se pudo guardar la hora programada', error);
  }
  for (const l of listeners) l();
}

export const getScheduled = (): ScheduledMap => current;

export function subscribeScheduled(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useScheduled(): ScheduledMap {
  return useSyncExternalStore(subscribeScheduled, getScheduled, getScheduled);
}

/** Programa (o cambia la hora de) un vídeo. Ignora fechas que no tengan el formato `YYYY-MM-DDTHH:mm`. */
export function setScheduled(videoId: string, localDateTime: string): void {
  if (!LOCAL_DATETIME.test(localDateTime)) return;
  commit({ ...current, [videoId]: localDateTime });
}

export function clearScheduled(videoId: string): void {
  if (videoId in current) commit(Object.fromEntries(Object.entries(current).filter(([id]) => id !== videoId)));
}

/** Sustituye todas las horas programadas (al recibir cambios de otro dispositivo). */
export function replaceScheduled(map: ScheduledMap): void {
  commit(map);
}

/** Sólo para pruebas. */
export function resetScheduledForTests(map: ScheduledMap = {}): void {
  current = map;
  for (const l of listeners) l();
}

/** `YYYY-MM-DDTHH:mm` (hora local) → milisegundos; `NaN` si no es válido. */
export const localDateTimeToMs = (value: string): number => (LOCAL_DATETIME.test(value) ? new Date(value).getTime() : Number.NaN);

/** Milisegundos → `YYYY-MM-DDTHH:mm` en hora local. */
export function msToLocalDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export type PublishState = 'published' | 'due' | 'scheduled' | 'none';

/** Estado de un vídeo: publicado (marcado a mano) > pendiente de confirmar (llegó la hora programada) > programado > nada. */
export function publishState(videoId: string, published: ReadonlySet<string> | Readonly<Record<string, string>>, scheduled: ScheduledMap, nowMs: number): PublishState {
  const isPublished = published instanceof Set ? published.has(videoId) : videoId in published;
  if (isPublished) return 'published';
  const at = scheduled[videoId];
  if (at === undefined) return 'none';
  const ms = localDateTimeToMs(at);
  return !Number.isNaN(ms) && ms <= nowMs ? 'due' : 'scheduled';
}

/** «mié 21 oct · 19:00» (fecha corta + hora). */
export function formatScheduled(localDateTime: string): string {
  const ms = localDateTimeToMs(localDateTime);
  if (Number.isNaN(ms)) return localDateTime;
  const d = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(ms));
  return `${d} · ${localDateTime.slice(11)}`;
}

/**
 * Hora que se propone al programar: 1 h 30 min antes del partido (dentro de la franja orientativa de las 2 h previas) si todavía
 * queda tiempo; si no, dentro de 15 minutos redondeados. Es sólo una propuesta que el usuario cambia.
 */
export function defaultSchedule(kickoff: { readonly date: string; readonly time: string | null }, nowMs: number): string {
  if (kickoff.time !== null) {
    const start = localDateTimeToMs(`${kickoff.date}T${kickoff.time}`);
    const proposal = start - 90 * 60_000;
    if (!Number.isNaN(proposal) && proposal > nowMs) return msToLocalDateTime(proposal);
  }
  const step = 15 * 60_000;
  return msToLocalDateTime(Math.ceil((nowMs + step) / step) * step);
}
