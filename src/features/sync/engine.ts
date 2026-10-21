import { applyRemote, detectLocal, finalize, skewFrom, settle, type Applied, type Docs, type MergeHook, type Meta, type RemoteReply, type WireEntry } from './core.ts';

/** Una colección sincronizada: cómo leerla y cómo reemplazarla (el almacén la guarda y avisa a la interfaz). */
export interface Collection {
  readonly name: string;
  read(): Record<string, unknown>;
  write(next: Record<string, unknown>): void;
  /** Si el mismo elemento cambió en los dos dispositivos: valor fusionado (si no, gana el más reciente). */
  readonly merge?: MergeHook;
}

export interface SyncConnection {
  /** Dirección del Worker (sin barra final). */
  readonly url: string;
  readonly key: string;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface SyncDeps {
  readonly collections: readonly Collection[];
  loadMeta(): Meta;
  saveMeta(meta: Meta): void;
  readonly fetchFn?: FetchFn;
  readonly now?: () => number;
}

export interface SyncOutcome {
  /** Cambios de este dispositivo enviados. */
  readonly sent: number;
  /** Elementos recibidos de otros dispositivos y aplicados. */
  readonly received: number;
  /** Colecciones que cambiaron al recibir. */
  readonly changed: readonly string[];
}

export class SyncError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'auth' | 'missing' | 'rejected' | 'invalid' = 'rejected',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SyncError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function readAll(collections: readonly Collection[]): Docs {
  return Object.fromEntries(collections.map((c) => [c.name, c.read()]));
}

function parseReply(data: unknown): RemoteReply & { readonly now: number } {
  if (!isRecord(data) || typeof data['rev'] !== 'number' || typeof data['now'] !== 'number' || !isRecord(data['entries'])) throw new SyncError('El Worker respondió algo que no es una sincronización válida.', 'invalid');
  const entries: Record<string, WireEntry> = {};
  for (const [key, e] of Object.entries(data['entries'])) {
    if (!isRecord(e) || typeof e['t'] !== 'number') continue;
    entries[key] = e['d'] === true ? { t: e['t'], d: true } : { t: e['t'], v: e['v'] };
  }
  return { rev: data['rev'], now: data['now'], entries };
}

/** Una vuelta de sincronización: envía los cambios locales, recibe los de los demás y los aplica. Lanza `SyncError` con un mensaje en español. */
export async function syncOnce(connection: SyncConnection, deps: SyncDeps): Promise<SyncOutcome> {
  const fetchFn: FetchFn = deps.fetchFn ?? ((i, init) => fetch(i, init));
  const now = deps.now ?? Date.now;
  const hooks: Record<string, MergeHook> = Object.fromEntries(deps.collections.flatMap((c) => (c.merge === undefined ? [] : [[c.name, c.merge] as const])));

  async function post(since: number, changes: Readonly<Record<string, WireEntry>>): Promise<{ readonly reply: RemoteReply & { readonly now: number }; readonly skew: number }> {
    const sentAt = now();
    let response: Response;
    try {
      response = await fetchFn(`${connection.url}/sync`, {
        method: 'POST',
        headers: { authorization: `Bearer ${connection.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ since, changes }),
      });
    } catch (error) {
      throw new SyncError('No se pudo conectar con el Worker. Comprueba la dirección y la conexión a internet.', 'network', { cause: error });
    }
    if (response.status === 401) throw new SyncError('El Worker rechazó la clave: debe ser la misma que el secreto STATS_KEY.', 'auth');
    if (response.status === 404) throw new SyncError('Tu Worker aún no tiene la sincronización: pega en Cloudflare la versión nueva de stats-worker.js (ver docs/SINCRONIZACION.md).', 'missing');
    if (!response.ok) {
      let detail = `error ${String(response.status)}`;
      try {
        const body: unknown = await response.json();
        if (isRecord(body) && typeof body['error'] === 'string') detail = body['error'];
      } catch (error) {
        console.warn('Respuesta de error sin JSON', error);
      }
      throw new SyncError(`El Worker no aceptó la sincronización: ${detail}`, 'rejected');
    }
    let reply: RemoteReply & { readonly now: number };
    try {
      reply = parseReply(await response.json());
    } catch (error) {
      if (error instanceof SyncError) throw error;
      throw new SyncError('El Worker respondió algo que no es una sincronización válida.', 'invalid', { cause: error });
    }
    return { reply, skew: skewFrom(reply.now, sentAt, now()) };
  }

  /** Escribe en los almacenes las colecciones que cambiaron y devuelve su nombre. */
  function writeChanged(applied: Applied): string[] {
    const changed: string[] = [];
    for (const c of deps.collections) {
      const wanted = applied.next[c.name];
      if (wanted !== undefined && applied.adopted.some((a) => a.key.startsWith(`${c.name}/`))) {
        c.write({ ...wanted });
        changed.push(c.name);
      }
    }
    return changed;
  }

  let meta = deps.loadMeta();
  const changedAll = new Set<string>();
  let received = 0;

  // Paso A (sólo si hay colecciones que se fusionan, como las estadísticas): antes de enviar, se traen los cambios ajenos de ESAS colecciones
  // para unir las dos versiones en vez de que una pise a la otra. Lo demás (último en escribir) se resuelve en el paso B.
  const mergeable = Object.keys(detectLocal(readAll(deps.collections), meta, now()).outgoing).some((k) => hooks[k.slice(0, k.indexOf('/'))] !== undefined);
  if (mergeable) {
    const { reply, skew } = await post(meta.rev, {});
    const onlyMerge: Record<string, WireEntry> = Object.fromEntries(Object.entries(reply.entries).filter(([k, e]) => e.d !== true && hooks[k.slice(0, k.indexOf('/'))] !== undefined));
    const applied = applyRemote(readAll(deps.collections), meta, { rev: reply.rev, entries: onlyMerge }, hooks);
    for (const name of writeChanged(applied)) changedAll.add(name);
    received += applied.adopted.length;
    // La revisión no avanza: el paso B vuelve a pedir lo demás desde donde estaba.
    meta = finalize(meta, applied, readAll(deps.collections), meta.rev, skew);
  }

  // Paso B: enviar los cambios locales y recibir los de los demás.
  const detected = detectLocal(readAll(deps.collections), meta, now());
  const { reply, skew } = await post(meta.rev, detected.outgoing);
  const base = settle(detected, meta);
  // Se vuelve a leer lo local: el usuario pudo cambiar algo mientras esperábamos al servidor.
  const applied = applyRemote(readAll(deps.collections), base, reply, hooks);
  for (const name of writeChanged(applied)) changedAll.add(name);
  received += applied.adopted.length;
  deps.saveMeta(finalize(base, applied, readAll(deps.collections), reply.rev, skew));
  return { sent: Object.keys(detected.outgoing).length, received, changed: [...changedAll] };
}
