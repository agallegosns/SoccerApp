import type { Match } from './types.ts';
import { DataError } from './types.ts';

const PREFIX = 'futbol-sim:v1:';

interface CacheEntry {
  readonly savedAt: number;
  readonly matches: readonly Match[];
}

export interface Cached {
  readonly savedAt: number;
  readonly matches: readonly Match[];
}

/** Subconjunto de `Storage` que usamos; permite inyectar uno falso en pruebas. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch (error) {
    // Acceso denegado (modo privado estricto, cookies bloqueadas…): la app sigue sin caché persistente.
    console.warn('localStorage no disponible', error);
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function parseEntry(raw: string): CacheEntry | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    console.warn('Entrada de caché corrupta; se ignora', error);
    return null;
  }
  if (!isRecord(data) || typeof data['savedAt'] !== 'number' || !Array.isArray(data['matches'])) return null;
  return { savedAt: data['savedAt'], matches: data['matches'] as readonly Match[] };
}

/** Caché de partidos: memoria (rápida) + localStorage (sobrevive a recargas y a fallos de red). */
export class MatchCache {
  private readonly memory = new Map<string, Cached>();

  constructor(
    private readonly store: KeyValueStore | null = browserStore(),
    private readonly now: () => number = Date.now,
  ) {}

  /** Entrada en memoria si tiene menos de `maxAgeMs`. */
  getFresh(key: string, maxAgeMs: number): Cached | null {
    const hit = this.memory.get(key);
    return hit !== undefined && this.now() - hit.savedAt <= maxAgeMs ? hit : null;
  }

  /** Última copia conocida, aunque esté caducada (memoria o localStorage). */
  getStale(key: string): Cached | null {
    const hit = this.memory.get(key);
    if (hit !== undefined) return hit;
    const raw = this.store?.getItem(PREFIX + key) ?? null;
    if (raw === null) return null;
    const entry = parseEntry(raw);
    if (entry !== null) this.memory.set(key, entry);
    return entry;
  }

  set(key: string, matches: readonly Match[]): void {
    const entry: CacheEntry = { savedAt: this.now(), matches };
    this.memory.set(key, entry);
    try {
      this.store?.setItem(PREFIX + key, JSON.stringify(entry));
    } catch (error) {
      // Cuota llena: seguimos con la copia en memoria.
      console.warn('No se pudo guardar la caché en localStorage', error);
    }
  }
}

/** Lectura/escritura tipada de preferencias simples. */
export function readJson<T>(
  key: string,
  guard: (value: unknown) => value is T,
  store: KeyValueStore | null = browserStore(),
): T | null {
  const raw = store?.getItem(PREFIX + key) ?? null;
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return guard(value) ? value : null;
  } catch (error) {
    console.warn(`Preferencia ${key} corrupta; se ignora`, error);
    return null;
  }
}

export function writeJson(key: string, value: unknown, store: KeyValueStore | null = browserStore()): void {
  if (store === null) throw new DataError('storage', 'El almacenamiento local no está disponible en este navegador');
  try {
    store.setItem(PREFIX + key, JSON.stringify(value));
  } catch (error) {
    throw new DataError('storage', 'No se pudo guardar en el navegador (¿almacenamiento lleno?)', { cause: error });
  }
}

/** Claves guardadas (sin el prefijo de la app) que empiezan por `prefix`. */
export function listKeys(prefix: string, store: KeyValueStore | null = browserStore()): string[] {
  if (store === null || !('length' in store) || !('key' in store)) return [];
  const full = store as Storage;
  const out: string[] = [];
  for (let i = 0; i < full.length; i += 1) {
    const k = full.key(i);
    if (k !== null && k.startsWith(PREFIX + prefix)) out.push(k.slice(PREFIX.length));
  }
  return out;
}

export function removeKey(key: string, store: KeyValueStore | null = browserStore()): void {
  store?.removeItem(PREFIX + key);
}
