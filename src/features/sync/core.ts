/**
 * Núcleo (puro, sin React ni almacenamiento) de la sincronización entre dispositivos.
 *
 * Cada colección (vídeos, publicado, programado…) es un mapa `id → valor`. Cada elemento se sincroniza por separado con una marca de
 * tiempo (`t`): gana el cambio más reciente («último en escribir») y un borrado es una «lápida» (`d`) con su propia marca, así que
 * borrar en un dispositivo lo borra en el otro y volver a crear después lo recupera. No se inventa nada: sólo se copian los datos que
 * el usuario ya tiene en cada dispositivo.
 */

/** Colecciones sincronizadas: `colección → id → valor`. */
export type Docs = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/** Elemento tal como viaja entre el dispositivo y el Worker. */
export interface WireEntry {
  /** Instante del último cambio (ms, hora del servidor aproximada). */
  readonly t: number;
  /** `true` = elemento borrado (lápida). */
  readonly d?: true;
  readonly v?: unknown;
}

/** Lo que el dispositivo recuerda de cada elemento la última vez que se puso de acuerdo con el servidor. */
export interface MetaEntry {
  readonly t: number;
  readonly d?: true;
  /** Huella del valor acordado: si el valor local ya no la cumple, el usuario lo ha cambiado. */
  readonly h: string;
}

export interface Meta {
  /** Última revisión del servidor ya procesada. */
  readonly rev: number;
  /** Diferencia (ms) entre el reloj del servidor y el de este dispositivo, para que un reloj mal puesto no pise cambios ajenos. */
  readonly skew: number;
  readonly entries: Readonly<Record<string, MetaEntry>>;
}

export const EMPTY_META: Meta = { rev: 0, skew: 0, entries: {} };

export const keyOf = (collection: string, id: string): string => `${collection}/${id}`;

export function splitKey(key: string): { readonly collection: string; readonly id: string } | null {
  const at = key.indexOf('/');
  return at <= 0 || at === key.length - 1 ? null : { collection: key.slice(0, at), id: key.slice(at + 1) };
}

/** `JSON.stringify` devuelve `undefined` para `undefined`, aunque su tipo diga `string`. */
const toJson: (value: unknown) => string | undefined = (value) => JSON.stringify(value);

/** Huella de 53 bits (cyrb53) del valor en JSON: sirve para saber si cambió, no para seguridad. */
export function hashValue(value: unknown): string {
  const s = toJson(value) ?? 'undefined';
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}.${String(s.length)}`;
}

/** Diferencia de relojes a partir de la respuesta del servidor (se toma la mitad del viaje de ida y vuelta). */
export const skewFrom = (serverNow: number, sentAt: number, receivedAt: number): number => Math.round(serverNow - (sentAt + receivedAt) / 2);

export interface Detected {
  readonly meta: Meta;
  /** Cambios locales aún sin enviar. */
  readonly outgoing: Readonly<Record<string, WireEntry>>;
}

/**
 * Compara el estado local con lo acordado la última vez y devuelve los cambios del usuario (altas, ediciones y borrados).
 * No modifica nada: si el envío falla, la próxima vez se detectan igual.
 */
export function detectLocal(current: Docs, meta: Meta, now: number): Detected {
  const t = Math.round(now + meta.skew);
  const entries: Record<string, MetaEntry> = { ...meta.entries };
  const outgoing: Record<string, WireEntry> = {};
  const seen = new Set<string>();
  for (const [collection, items] of Object.entries(current)) {
    for (const [id, value] of Object.entries(items)) {
      const key = keyOf(collection, id);
      seen.add(key);
      const h = hashValue(value);
      const known = meta.entries[key];
      if (known === undefined || known.d === true || known.h !== h) {
        entries[key] = { t, h };
        outgoing[key] = { t, v: value };
      }
    }
  }
  for (const [key, known] of Object.entries(meta.entries)) {
    if (known.d !== true && !seen.has(key)) {
      entries[key] = { t, d: true, h: '' };
      outgoing[key] = { t, d: true };
    }
  }
  return { meta: { ...meta, entries }, outgoing };
}

/** Qué hacer cuando el mismo elemento cambió en los dos dispositivos: devuelve el valor fusionado (p. ej. uniendo mediciones). */
export type MergeHook = (local: unknown, remote: unknown) => unknown;

export interface RemoteReply {
  readonly rev: number;
  readonly entries: Readonly<Record<string, WireEntry>>;
}

export interface Applied {
  /** Estado que debe quedar guardado en el dispositivo. */
  readonly next: Docs;
  /** Elementos adoptados del servidor; `merged` = el valor local se fusionó y hay que reenviarlo. */
  readonly adopted: readonly { readonly key: string; readonly merged: boolean; readonly remote: WireEntry }[];
}

/** Aplica lo que llegó del servidor: se adopta cada elemento más reciente que el local. */
export function applyRemote(current: Docs, meta: Meta, reply: RemoteReply, hooks: Readonly<Record<string, MergeHook>> = {}): Applied {
  const next: Record<string, Record<string, unknown>> = {};
  for (const [collection, items] of Object.entries(current)) next[collection] = { ...items };
  const adopted: { key: string; merged: boolean; remote: WireEntry }[] = [];
  for (const [key, entry] of Object.entries(reply.entries)) {
    const at = splitKey(key);
    if (at === null) continue;
    const known = meta.entries[key];
    if (known !== undefined && known.t >= entry.t) continue;
    const bucket = (next[at.collection] ??= {});
    if (entry.d === true) {
      Reflect.deleteProperty(bucket, at.id);
      adopted.push({ key, merged: false, remote: entry });
      continue;
    }
    const local = bucket[at.id];
    const hook = hooks[at.collection];
    const merged = local !== undefined && hook !== undefined && hashValue(local) !== hashValue(entry.v) ? hook(local, entry.v) : undefined;
    const useMerged = merged !== undefined && hashValue(merged) !== hashValue(entry.v);
    bucket[at.id] = useMerged ? merged : entry.v;
    adopted.push({ key, merged: useMerged, remote: entry });
  }
  return { next, adopted };
}

/**
 * Anota en `meta` lo adoptado. `after` es el estado local tras guardar (los almacenes pueden normalizar los valores, así que la huella se
 * calcula sobre lo realmente guardado). Los elementos fusionados quedan con la huella del servidor para que el siguiente envío los suba.
 */
export function finalize(meta: Meta, applied: Applied, after: Docs, rev: number, skew: number): Meta {
  const entries: Record<string, MetaEntry> = { ...meta.entries };
  for (const { key, merged, remote } of applied.adopted) {
    if (remote.d === true) {
      entries[key] = { t: remote.t, d: true, h: '' };
      continue;
    }
    const at = splitKey(key);
    const stored = at === null ? undefined : after[at.collection]?.[at.id];
    entries[key] = { t: remote.t, h: hashValue(merged ? remote.v : stored) };
  }
  return { rev, skew, entries };
}

/** Marca como acordados los cambios locales que el servidor aceptó (los que rechazó se resuelven con `applyRemote`). */
export const settle = (detected: Detected, base: Meta): Meta => ({ ...base, entries: detected.meta.entries });
