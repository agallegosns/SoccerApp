/**
 * Estadísticas de publicación en TikTok e Instagram. Son datos REALES que el usuario introduce o importa (la app no puede leerlos sola:
 * ver ARCHITECTURE.md → «Estadísticas»). Cada medición es una «foto» acumulada de los contadores de la publicación en una fecha.
 */
export type Platform = 'tiktok' | 'instagram';

export const PLATFORMS: readonly { readonly id: Platform; readonly label: string }[] = [
  { id: 'tiktok', label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
];

export const platformLabel = (p: Platform): string => (p === 'tiktok' ? 'TikTok' : 'Instagram');

export interface Metrics {
  readonly views: number;
  readonly likes: number;
  readonly comments: number;
  readonly shares: number;
  readonly saves: number;
  /** Cuentas alcanzadas (sólo si la plataforma lo da). */
  readonly reach: number | null;
}

export interface Measurement extends Metrics {
  /** `YYYY-MM-DD`. */
  readonly date: string;
}

export interface Publication {
  readonly id: string;
  readonly platform: Platform;
  /** Enlace a la publicación (puede estar vacío). */
  readonly url: string;
  readonly title: string;
  /** `YYYY-MM-DD`. */
  readonly publishedAt: string;
  /** Instante exacto (ISO 8601) si la plataforma lo dio (Worker automático); permite analizar la hora de publicación. */
  readonly publishedAtIso?: string;
  /** Ficha de vídeo de la biblioteca a la que corresponde, si se indicó. */
  readonly videoId: string | null;
  /** Ordenadas por fecha ascendente; una por fecha. */
  readonly measurements: readonly Measurement[];
}

export const MAX_PUBLICATIONS = 500;
export const MAX_TITLE = 120;
export const MAX_COUNT = 10_000_000_000;

export const EMPTY_METRICS: Metrics = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, reach: null };

export const isIsoDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
};

/** Acepta `YYYY-MM-DD` y `DD/MM/YYYY` (o con guiones/puntos). Devuelve `null` si no es una fecha válida. */
export function parseDateLoose(raw: string): string | null {
  const t = raw.trim();
  if (isIsoDate(t)) return t;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m === null) return null;
  const iso = `${m[3] ?? ''}-${(m[2] ?? '').padStart(2, '0')}-${(m[1] ?? '').padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}

/** Quita parámetros de seguimiento y la barra final para reconocer el mismo enlace aunque cambie su cola. */
export function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (t === '') return '';
  try {
    const u = new URL(t);
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return t;
  }
}

/** `null` si el enlace es válido para la plataforma (o está vacío); si no, el motivo en español. */
export function urlProblem(platform: Platform, raw: string): string | null {
  const t = raw.trim();
  if (t === '') return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return 'El enlace no es una URL válida (debe empezar por https://).';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'El enlace debe empezar por https://.';
  const host = u.hostname.toLowerCase();
  const ok = platform === 'tiktok' ? /(^|\.)tiktok\.com$/.test(host) : /(^|\.)instagram\.com$/.test(host);
  return ok ? null : `El enlace no parece de ${platformLabel(platform)}.`;
}

function hash64(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x811c9dc5) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** Identidad de una publicación: plataforma + enlace (o, sin enlace, título y fecha). Importar dos veces el mismo CSV no duplica. */
export function publicationId(platform: Platform, url: string, title: string, publishedAt: string): string {
  const key = normalizeUrl(url);
  return hash64(key !== '' ? `${platform}|${key}` : `${platform}|${title.trim().toLowerCase()}|${publishedAt}`);
}

export const latest = (p: Publication): Measurement | null => p.measurements[p.measurements.length - 1] ?? null;

export function sortMeasurements(list: readonly Measurement[]): Measurement[] {
  const byDate = new Map<string, Measurement>();
  for (const m of list) byDate.set(m.date, m); // la última de cada fecha gana
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface Totals extends Metrics {
  readonly publications: number;
  /** (likes + comentarios + compartidos + guardados) / vistas, o `null` sin vistas. */
  readonly engagement: number | null;
}

export const engagementOf = (m: Metrics): number | null => (m.views > 0 ? (m.likes + m.comments + m.shares + m.saves) / m.views : null);

/** Suma de la última medición de cada publicación. */
export function totalsOf(pubs: readonly Publication[]): Totals {
  let views = 0;
  let likes = 0;
  let comments = 0;
  let shares = 0;
  let saves = 0;
  let reach = 0;
  let anyReach = false;
  let counted = 0;
  for (const p of pubs) {
    const m = latest(p);
    if (m === null) continue;
    counted += 1;
    views += m.views;
    likes += m.likes;
    comments += m.comments;
    shares += m.shares;
    saves += m.saves;
    if (m.reach !== null) {
      reach += m.reach;
      anyReach = true;
    }
  }
  const base: Metrics = { views, likes, comments, shares, saves, reach: anyReach ? reach : null };
  return { ...base, publications: counted, engagement: engagementOf(base) };
}

export interface TimelinePoint {
  readonly date: string;
  readonly views: number;
  readonly likes: number;
}

/** Evolución del total: en cada fecha con alguna medición, la suma de la última medición conocida de cada publicación hasta ese día. */
export function timelineOf(pubs: readonly Publication[]): TimelinePoint[] {
  const dates = [...new Set(pubs.flatMap((p) => p.measurements.map((m) => m.date)))].sort();
  return dates.map((date) => {
    let views = 0;
    let likes = 0;
    for (const p of pubs) {
      let last: Measurement | null = null;
      for (const m of p.measurements) if (m.date <= date) last = m;
      if (last !== null) {
        views += last.views;
        likes += last.likes;
      }
    }
    return { date, views, likes };
  });
}

export type SortKey = 'views' | 'likes' | 'engagement' | 'recent';

export function rankPublications(pubs: readonly Publication[], key: SortKey): Publication[] {
  const value = (p: Publication): number => {
    const m = latest(p);
    if (key === 'recent') return Date.parse(`${p.publishedAt}T00:00:00Z`);
    if (m === null) return -1;
    if (key === 'views') return m.views;
    if (key === 'likes') return m.likes;
    return engagementOf(m) ?? -1;
  };
  return [...pubs].sort((a, b) => value(b) - value(a) || a.title.localeCompare(b.title));
}

/** Une publicaciones por id: las mediciones se fusionan por fecha (la entrante gana) y los datos de la entrante rellenan los vacíos. */
export function mergePublications(existing: readonly Publication[], incoming: readonly Publication[]): Publication[] {
  const map = new Map(existing.map((p) => [p.id, p] as const));
  for (const inc of incoming) {
    const old = map.get(inc.id);
    map.set(
      inc.id,
      old === undefined
        ? inc
        : {
            ...old,
            url: inc.url !== '' ? inc.url : old.url,
            title: inc.title !== '' ? inc.title : old.title,
            publishedAt: inc.publishedAt,
            ...(inc.publishedAtIso !== undefined ? { publishedAtIso: inc.publishedAtIso } : old.publishedAtIso !== undefined ? { publishedAtIso: old.publishedAtIso } : {}),
            videoId: inc.videoId ?? old.videoId,
            measurements: sortMeasurements([...old.measurements, ...inc.measurements]),
          },
    );
  }
  return [...map.values()].slice(0, MAX_PUBLICATIONS);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Validación de lo guardado en el navegador

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_COUNT ? v : null);

export function toMeasurement(v: unknown): Measurement | null {
  if (!isRecord(v) || !isIsoDate(v['date'])) return null;
  const views = count(v['views']);
  const likes = count(v['likes']);
  const comments = count(v['comments']);
  const shares = count(v['shares']);
  const saves = count(v['saves']);
  const reach = v['reach'] === null || v['reach'] === undefined ? null : count(v['reach']);
  if (views === null || likes === null || comments === null || shares === null || saves === null) return null;
  if (v['reach'] !== null && v['reach'] !== undefined && reach === null) return null;
  return { date: v['date'], views, likes, comments, shares, saves, reach };
}

export function toPublication(v: unknown): Publication | null {
  if (!isRecord(v)) return null;
  const platform: Platform | null = v['platform'] === 'tiktok' || v['platform'] === 'instagram' ? v['platform'] : null;
  if (platform === null || typeof v['title'] !== 'string' || typeof v['url'] !== 'string' || !isIsoDate(v['publishedAt'])) return null;
  const title = v['title'].replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  if (title === '') return null;
  const measurements = sortMeasurements((Array.isArray(v['measurements']) ? (v['measurements'] as unknown[]) : []).flatMap((m) => toMeasurement(m) ?? []));
  const url = v['url'].trim();
  return {
    id: publicationId(platform, url, title, v['publishedAt']),
    platform,
    url,
    title,
    publishedAt: v['publishedAt'],
    ...(typeof v['publishedAtIso'] === 'string' && !Number.isNaN(Date.parse(v['publishedAtIso'])) ? { publishedAtIso: v['publishedAtIso'] } : {}),
    videoId: typeof v['videoId'] === 'string' && v['videoId'] !== '' ? v['videoId'] : null,
    measurements,
  };
}

export function toPublications(v: unknown): Publication[] {
  if (!Array.isArray(v)) return [];
  return mergePublications([], (v as unknown[]).flatMap((p) => toPublication(p) ?? []));
}
