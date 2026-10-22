import { useSyncExternalStore } from 'react';

import { isBusy } from '../../app/busy.ts';
import { readJson, removeKey, writeJson } from '../../data/cache.ts';
import { subscribeDownloaded } from '../../data/downloaded.ts';
import { isRecord } from '../../data/parsers.ts';
import { subscribeStats } from '../stats/store.ts';
import { readSyncConfig } from '../stats/sync.ts';
import { subscribePublished } from '../videos/published.ts';
import { subscribeScheduled } from '../videos/scheduled.ts';
import { subscribeVideos } from '../videos/store.ts';
import { ALL_COLLECTIONS } from './collections.ts';
import { EMPTY_META, type Meta, type MetaEntry } from './core.ts';
import { syncOnce, SyncError, type SyncConnection } from './engine.ts';

const CONFIG_KEY = 'device-sync';
const META_KEY = 'device-sync-meta';
export const SYNC_EVERY_MS = 60_000;
const DEBOUNCE_MS = 4_000;

export type DeviceSyncStatus = 'off' | 'idle' | 'syncing' | 'ok' | 'error';

export interface DeviceSyncState {
  readonly status: DeviceSyncStatus;
  /** Última vez que terminó bien (ms). */
  readonly lastOkAt: number | null;
  readonly message: string | null;
  /** Se recibieron calendarios importados: se ven al recargar la app. */
  readonly needsReload: boolean;
  /** Resumen de la última vuelta. */
  readonly last: { readonly sent: number; readonly received: number } | null;
}

// ---- Conexión y huella guardadas en el navegador ------------------------------------------------------------------------------------

const isConnection = (v: unknown): v is SyncConnection => isRecord(v) && typeof v['url'] === 'string' && typeof v['key'] === 'string';

export function readConnection(): SyncConnection | null {
  try {
    const c = readJson(CONFIG_KEY, isConnection);
    return c !== null && c.url !== '' && c.key !== '' ? c : null;
  } catch (error) {
    console.warn('No se pudo leer la conexión de sincronización', error);
    return null;
  }
}

const isMetaEntry = (v: unknown): v is MetaEntry => isRecord(v) && typeof v['t'] === 'number' && typeof v['h'] === 'string' && (v['d'] === undefined || v['d'] === true);
const isMeta = (v: unknown): v is Meta => isRecord(v) && typeof v['rev'] === 'number' && typeof v['skew'] === 'number' && isRecord(v['entries']) && Object.values(v['entries']).every(isMetaEntry);

function loadMeta(): Meta {
  try {
    return readJson(META_KEY, isMeta) ?? EMPTY_META;
  } catch (error) {
    console.warn('No se pudo leer el estado de sincronización: se empieza de cero', error);
    return EMPTY_META;
  }
}

function saveMeta(meta: Meta): void {
  try {
    writeJson(META_KEY, meta);
  } catch (error) {
    console.warn('No se pudo guardar el estado de sincronización', error);
  }
}

// ---- Estado visible ---------------------------------------------------------------------------------------------------------------------

const initial = (): DeviceSyncState => ({ status: readConnection() === null ? 'off' : 'idle', lastOkAt: null, message: null, needsReload: false, last: null });
let state: DeviceSyncState = initial();
const listeners = new Set<() => void>();

function setState(next: Partial<DeviceSyncState>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export const getDeviceSyncState = (): DeviceSyncState => state;

export function subscribeDeviceSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const useDeviceSync = (): DeviceSyncState => useSyncExternalStore(subscribeDeviceSync, getDeviceSyncState, getDeviceSyncState);

const cleanUrl = (url: string): string => url.trim().replace(/\/+$/, '');

/** `null` si es válida; si no, el motivo en español. */
export function connectionProblem(url: string, key: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return 'La dirección del Worker no es una URL válida (debe empezar por https://).';
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return 'La dirección del Worker debe empezar por https://.';
  if (key.trim().length < 24) return 'La clave debe tener al menos 24 caracteres (la misma que el secreto STATS_KEY del Worker).';
  return null;
}

/** Guarda la conexión y empieza a sincronizar. */
export function saveConnection(url: string, key: string): void {
  writeJson(CONFIG_KEY, { url: cleanUrl(url), key: key.trim() });
  setState({ status: 'idle', message: null });
  void runDeviceSync();
}

/** Deja de sincronizar en este dispositivo (los datos se quedan donde están y la huella se olvida). */
export function clearConnection(): void {
  removeKey(CONFIG_KEY);
  removeKey(META_KEY);
  setState({ status: 'off', message: null, last: null, lastOkAt: null, needsReload: false });
}

/** La misma conexión (dirección y clave) que ya se puso en Estadísticas, si la hay. */
export const statsConnection = (): SyncConnection | null => readSyncConfig();

let running = false;

/** Una vuelta de sincronización. Nunca lanza: deja el resultado en el estado. */
export async function runDeviceSync(fetchFn?: (input: string, init?: RequestInit) => Promise<Response>): Promise<void> {
  const connection = readConnection();
  if (connection === null) {
    setState({ status: 'off' });
    return;
  }
  // No se tocan los almacenes mientras se exporta un vídeo o se genera un lote.
  if (running || isBusy()) return;
  running = true;
  setState({ status: 'syncing', message: null });
  try {
    const outcome = await syncOnce(connection, { collections: ALL_COLLECTIONS, loadMeta, saveMeta, ...(fetchFn === undefined ? {} : { fetchFn }) });
    setState({
      status: 'ok',
      lastOkAt: Date.now(),
      message: null,
      last: { sent: outcome.sent, received: outcome.received },
      needsReload: state.needsReload || outcome.changed.includes('imported'),
    });
  } catch (error) {
    console.warn('Fallo al sincronizar', error);
    setState({ status: 'error', message: error instanceof SyncError ? error.message : 'No se pudo sincronizar por un error inesperado.' });
  } finally {
    running = false;
  }
}

let stop: (() => void) | null = null;

/**
 * Sincroniza al abrir la app, cada minuto mientras está a la vista, al volver a ella, al recuperar la conexión y unos segundos después
 * de cada cambio local. Sólo funciona con la app abierta: no hay servidor que avise a un dispositivo cerrado.
 */
export function startDeviceSync(): () => void {
  stop?.();
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const tick = (): void => {
    if (document.visibilityState === 'visible') void runDeviceSync();
  };
  const onLocalChange = (): void => {
    if (running || readConnection() === null) return;
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => void runDeviceSync(), DEBOUNCE_MS);
  };
  const unsubscribers = [subscribeVideos, subscribePublished, subscribeScheduled, subscribeDownloaded, subscribeStats].map((subscribe) => subscribe(onLocalChange));
  const timer = setInterval(tick, SYNC_EVERY_MS);
  document.addEventListener('visibilitychange', tick);
  window.addEventListener('online', tick);
  tick();
  stop = () => {
    clearInterval(timer);
    if (debounce !== null) clearTimeout(debounce);
    document.removeEventListener('visibilitychange', tick);
    window.removeEventListener('online', tick);
    for (const u of unsubscribers) u();
    stop = null;
  };
  return stop;
}

/** Sólo para pruebas. */
export function resetDeviceSyncForTests(): void {
  running = false;
  state = initial();
  for (const l of listeners) l();
}
