/**
 * Sincronización automática de estadísticas. Un Worker propio de Cloudflare (ver `cloudflare/stats-worker.ts`) consulta cada 30 minutos las APIs
 * oficiales de Instagram y TikTok y la app lee su resultado. Todo lo que llega es dato real; lo que la API no da (`null`) no se rellena con ceros.
 */
import { removeKey, readJson, writeJson } from '../../data/cache.ts';
import { todayLocal } from '../../data/dates.ts';
import {
  MAX_TITLE,
  latest,
  publicationId,
  urlProblem,
  type Measurement,
  type Platform,
  type Publication,
} from './model.ts';
import { getPublications, importPublications } from './store.ts';

export const SYNC_INTERVAL_MS = 30 * 60_000;
const REQUEST_TIMEOUT_MS = 20_000;

export interface SyncConfig {
  /** URL del Worker, sin barra final (p. ej. `https://futbol-stats.tuusuario.workers.dev`). */
  readonly url: string;
  /** Clave de lectura (la misma que el secreto STATS_KEY del Worker). */
  readonly key: string;
}

export type SourceState = 'ok' | 'sin-configurar' | 'sin-autorizar' | 'error';

export interface SnapshotItem {
  readonly platform: Platform;
  readonly url: string;
  readonly title: string;
  readonly publishedAt: string;
  readonly publishedAtIso?: string;
  readonly views: number | null;
  readonly likes: number | null;
  readonly comments: number | null;
  readonly shares: number | null;
  readonly saves: number | null;
  readonly reach: number | null;
}

export interface Snapshot {
  readonly updatedAt: string;
  readonly sources: Readonly<Record<Platform, { readonly state: SourceState; readonly message: string | null }>>;
  readonly items: readonly SnapshotItem[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
const STATES: readonly string[] = ['ok', 'sin-configurar', 'sin-autorizar', 'error'];

function parseSource(v: unknown): { state: SourceState; message: string | null } {
  if (!isRecord(v) || typeof v['state'] !== 'string' || !STATES.includes(v['state'])) return { state: 'error', message: 'Estado desconocido' };
  return { state: v['state'] as SourceState, message: typeof v['message'] === 'string' ? v['message'] : null };
}

/** Valida lo recibido del Worker (es entrada externa: nada se da por bueno). `null` si no tiene la forma esperada. */
export function parseSnapshot(raw: unknown): Snapshot | null {
  if (!isRecord(raw) || raw['version'] !== 1 || typeof raw['updatedAt'] !== 'string' || Number.isNaN(Date.parse(raw['updatedAt']))) return null;
  if (!Array.isArray(raw['items']) || !isRecord(raw['sources'])) return null;
  const items: SnapshotItem[] = [];
  for (const it of raw['items'] as unknown[]) {
    if (!isRecord(it)) continue;
    const platform = it['platform'];
    if (platform !== 'instagram' && platform !== 'tiktok') continue;
    const url = typeof it['url'] === 'string' ? it['url'] : '';
    const published = typeof it['publishedAt'] === 'string' ? it['publishedAt'] : '';
    if (url === '' || urlProblem(platform, url) !== null || !/^\d{4}-\d{2}-\d{2}$/.test(published)) continue;
    items.push({
      platform,
      url,
      title: typeof it['title'] === 'string' ? it['title'].replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) : '',
      publishedAt: published,
      ...(typeof it['publishedAtIso'] === 'string' && !Number.isNaN(Date.parse(it['publishedAtIso'])) ? { publishedAtIso: it['publishedAtIso'] } : {}),
      views: count(it['views']),
      likes: count(it['likes']),
      comments: count(it['comments']),
      shares: count(it['shares']),
      saves: count(it['saves']),
      reach: count(it['reach']),
    });
  }
  return { updatedAt: raw['updatedAt'], sources: { instagram: parseSource(raw['sources']['instagram']), tiktok: parseSource(raw['sources']['tiktok']) }, items };
}

/**
 * Convierte la instantánea en publicaciones con UNA medición (la de la fecha local de `updatedAt`). Cada contador que la API no dio se
 * conserva de la última medición que ya hubiera (p. ej. «guardados» de TikTok, que la API no ofrece) o queda a 0 si nunca se supo.
 */
export function snapshotToPublications(snapshot: Snapshot, existing: readonly Publication[]): Publication[] {
  const date = todayLocal(new Date(snapshot.updatedAt));
  const byId = new Map(existing.map((p) => [p.id, p] as const));
  const out: Publication[] = [];
  for (const item of snapshot.items) {
    const title = item.title === '' ? (item.platform === 'tiktok' ? 'Vídeo de TikTok' : 'Publicación de Instagram') : item.title;
    const id = publicationId(item.platform, item.url, title, item.publishedAt);
    const prev = byId.get(id);
    const last = prev === undefined ? null : latest(prev);
    const measurement: Measurement = {
      date,
      views: item.views ?? last?.views ?? 0,
      likes: item.likes ?? last?.likes ?? 0,
      comments: item.comments ?? last?.comments ?? 0,
      shares: item.shares ?? last?.shares ?? 0,
      saves: item.saves ?? last?.saves ?? 0,
      reach: item.reach ?? last?.reach ?? null,
    };
    out.push({ id, platform: item.platform, url: item.url, title: prev?.title ?? title, publishedAt: item.publishedAt, ...(item.publishedAtIso !== undefined ? { publishedAtIso: item.publishedAtIso } : {}), videoId: null, measurements: [measurement] });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Configuración guardada en el navegador

const isConfig = (v: unknown): v is SyncConfig => isRecord(v) && typeof v['url'] === 'string' && typeof v['key'] === 'string';

export function readSyncConfig(): SyncConfig | null {
  try {
    const c = readJson('stats-sync', isConfig);
    return c !== null && c.url !== '' && c.key !== '' ? c : null;
  } catch (error) {
    console.warn('No se pudo leer la conexión de estadísticas', error);
    return null;
  }
}

/** `null` si es válida; si no, el motivo en español. */
export function configProblem(url: string, key: string): string | null {
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

export const cleanUrl = (url: string): string => url.trim().replace(/\/+$/, '');

// ---------------------------------------------------------------------------------------------------------------------------------
// Estado de la sincronización (lo ve la interfaz)

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'ok' | 'error';

export interface SyncState {
  readonly status: SyncStatus;
  /** Cuándo recogió datos el Worker por última vez (ISO). */
  readonly snapshotAt: string | null;
  /** Cuándo comprobó la app por última vez (ms). */
  readonly checkedAt: number | null;
  readonly message: string | null;
  readonly sources: Snapshot['sources'] | null;
  readonly changed: number;
}

const initialState = (): SyncState => ({ status: readSyncConfig() === null ? 'off' : 'idle', snapshotAt: null, checkedAt: null, message: null, sources: null, changed: 0 });

let state: SyncState = initialState();
const listeners = new Set<() => void>();

function setState(next: Partial<SyncState>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export const getSyncState = (): SyncState => state;
export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function saveSyncConfig(config: SyncConfig): void {
  writeJson('stats-sync', { url: cleanUrl(config.url), key: config.key.trim() });
  setState({ status: 'idle', message: null, sources: null, snapshotAt: null, checkedAt: null });
}

export function clearSyncConfig(): void {
  removeKey('stats-sync');
  setState({ status: 'off', message: null, sources: null, snapshotAt: null, checkedAt: null, changed: 0 });
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Pide la instantánea al Worker y la fusiona con las publicaciones guardadas. Nunca lanza: deja el resultado en el estado. */
export async function runSync(fetchFn: FetchFn = (i, init) => fetch(i, init), now: () => number = Date.now): Promise<void> {
  const config = readSyncConfig();
  if (config === null) {
    setState({ status: 'off' });
    return;
  }
  if (state.status === 'syncing') return;
  setState({ status: 'syncing', message: null });
  try {
    const res = await fetchFn(`${config.url}/stats`, { headers: { authorization: `Bearer ${config.key}` }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: 'no-store' });
    if (res.status === 401) throw new SyncError('El Worker rechazó la clave. Comprueba que es la misma que el secreto STATS_KEY.');
    if (res.status === 404) throw new SyncError('El Worker todavía no tiene datos. Espera a su primera ejecución (máx. 30 min) o pulsa «Actualizar ahora» tras autorizar las cuentas.');
    if (!res.ok) throw new SyncError(`El Worker respondió con un error (HTTP ${String(res.status)}).`);
    const snapshot = parseSnapshot((await res.json()) as unknown);
    if (snapshot === null) throw new SyncError('La respuesta del Worker no tiene el formato esperado. ¿La dirección apunta al Worker de estadísticas?');
    const incoming = snapshotToPublications(snapshot, getPublications());
    const problem = importPublications(incoming);
    if (problem !== null) throw new SyncError(`Se recibieron los datos pero no se pudieron guardar: ${problem}`);
    setState({ status: 'ok', snapshotAt: snapshot.updatedAt, checkedAt: now(), message: null, sources: snapshot.sources, changed: incoming.length });
  } catch (error) {
    console.warn('No se pudo actualizar las estadísticas', error);
    const message =
      error instanceof SyncError
        ? error.message
        : error instanceof DOMException && error.name === 'TimeoutError'
          ? 'El Worker tardó demasiado en responder.'
          : 'No se pudo contactar con el Worker (¿sin conexión, dirección incorrecta o CORS mal configurado?).';
    setState({ status: 'error', checkedAt: now(), message });
  }
}

class SyncError extends Error {}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Arranca la actualización automática: al abrir la app, cada 30 minutos mientras esté abierta y al volver a la pestaña si han pasado 30 minutos.
 * (El Worker recoge los datos cada 30 minutos aunque la app esté cerrada; la app los lee cuando se abre.)
 */
export function startAutoSync(fetchFn?: FetchFn): () => void {
  const tick = (): void => {
    void runSync(fetchFn);
  };
  const onVisible = (): void => {
    if (document.visibilityState !== 'visible') return;
    const last = state.checkedAt;
    if (last === null || Date.now() - last >= SYNC_INTERVAL_MS) tick();
  };
  if (timer !== null) clearInterval(timer);
  tick();
  timer = setInterval(tick, SYNC_INTERVAL_MS);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** Sólo para pruebas. */
export function resetSyncForTests(): void {
  state = initialState();
  for (const l of listeners) l();
}

