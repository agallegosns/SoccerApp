/**
 * Actualización automática. Cada compilación publica `version.json` con su identificador; la app lo consulta al abrirse, al volver
 * a primer plano, al recuperar la conexión y cada pocos minutos. Si hay una versión nueva se recarga sola, salvo que haya una
 * exportación en curso (entonces espera a que termine). No usa service worker: así nunca se queda con una copia vieja en caché.
 */
export const CHECK_EVERY_MS = 5 * 60_000;
const GUARD_KEY = 'futbol-sim:v1:updated-to';
const GUARD_MS = 2 * 60_000;

export interface UpdaterDeps {
  readonly currentId: string;
  readonly baseUrl: string;
  readonly isBusy: () => boolean;
  readonly subscribeBusy: (listener: () => void) => () => void;
  readonly reload: () => void;
  readonly fetchFn?: typeof fetch;
  readonly now?: () => number;
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

export async function fetchLatestBuildId(baseUrl: string, fetchFn: typeof fetch = fetch, now: () => number = Date.now): Promise<string | null> {
  try {
    const response = await fetchFn(`${baseUrl}version.json?t=${String(now())}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (typeof data === 'object' && data !== null && 'id' in data && typeof data.id === 'string') return data.id;
    return null;
  } catch (error) {
    // Sin red o sin version.json (desarrollo): no pasa nada, se vuelve a intentar más tarde.
    console.debug('No se pudo comprobar la versión', error);
    return null;
  }
}

export interface Updater {
  readonly check: () => Promise<void>;
  readonly pending: () => boolean;
  readonly subscribePending: (listener: () => void) => () => void;
  readonly stop: () => void;
}

export function createUpdater(deps: UpdaterDeps): Updater {
  const now = deps.now ?? Date.now;
  const storage = deps.storage ?? null;
  const fetchFn = deps.fetchFn ?? fetch;
  let pendingId: string | null = null;
  const pendingListeners = new Set<() => void>();
  let offBusy: (() => void) | null = null;

  function setPending(id: string | null): void {
    if (pendingId === id) return;
    pendingId = id;
    for (const l of pendingListeners) l();
  }

  /** Evita un bucle de recargas si el servidor aún sirve la versión vieja desde caché. */
  function recentlyTried(id: string): boolean {
    try {
      const raw = storage?.getItem(GUARD_KEY) ?? null;
      if (raw === null) return false;
      const [savedId, at] = raw.split('|');
      return savedId === id && now() - Number(at) < GUARD_MS;
    } catch (error) {
      console.debug('Sin acceso al almacenamiento', error);
      return false;
    }
  }

  function applyIfIdle(): void {
    if (pendingId === null || deps.isBusy()) return;
    if (recentlyTried(pendingId)) return;
    try {
      storage?.setItem(GUARD_KEY, `${pendingId}|${String(now())}`);
    } catch (error) {
      console.debug('No se pudo guardar la marca de actualización', error);
    }
    offBusy?.();
    offBusy = null;
    deps.reload();
  }

  async function check(): Promise<void> {
    const latest = await fetchLatestBuildId(deps.baseUrl, fetchFn, now);
    if (latest === null || latest === deps.currentId) {
      setPending(null);
      return;
    }
    setPending(latest);
    offBusy ??= deps.subscribeBusy(applyIfIdle);
    applyIfIdle();
  }

  return {
    check,
    pending: () => pendingId !== null,
    subscribePending: (listener) => {
      pendingListeners.add(listener);
      return () => {
        pendingListeners.delete(listener);
      };
    },
    stop: () => {
      offBusy?.();
      offBusy = null;
    },
  };
}
