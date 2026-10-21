/**
 * Worker de Cloudflare (plan gratuito) que recoge cada 30 minutos las estadísticas de TUS publicaciones de Instagram y TikTok
 * con las APIs oficiales y las deja en una «instantánea» que la app lee en `GET /stats`.
 *
 * Por qué existe: ambas APIs exigen un inicio de sesión (OAuth) con una clave secreta; esa clave no puede vivir en el navegador.
 * Aquí viven como secretos del Worker. El código NO lleva ninguna clave.
 *
 * Ver `docs/ESTADISTICAS-AUTOMATICAS.md` para publicarlo paso a paso. Se compila a `cloudflare/stats-worker.js` con `npm run build:worker`.
 */

// ---------------------------------------------------------------------------------------------------------------------------------
// Tipos mínimos de Cloudflare (para no depender de @cloudflare/workers-types)

export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
  /** KV donde se guardan la instantánea y los tokens renovados. */
  readonly STATS: KV;
  /** Clave de lectura que la app envía en `Authorization: Bearer …`. Inventada por ti (≥ 24 caracteres). */
  readonly STATS_KEY: string;
  /** Origen permitido por CORS (p. ej. `https://agallegosns.github.io`). Si falta, se permite cualquiera. */
  readonly ALLOWED_ORIGIN?: string;
  /** Token de Instagram (Instagram API con inicio de sesión de Instagram). Opcional si sólo usas TikTok. */
  readonly IG_TOKEN?: string;
  readonly IG_API_VERSION?: string;
  /** Credenciales de la app de TikTok (TikTok for Developers). Opcionales si sólo usas Instagram. */
  readonly TIKTOK_CLIENT_KEY?: string;
  readonly TIKTOK_CLIENT_SECRET?: string;
  /** Cuántas publicaciones recientes de cada plataforma se consultan (por defecto 20; el plan gratuito limita las peticiones por ejecución). */
  readonly MAX_ITEMS?: string;
}

export type Platform = 'instagram' | 'tiktok';

/** Una publicación con sus contadores acumulados. `null` = la API no da ese dato (no se inventa). */
export interface SnapshotItem {
  readonly platform: Platform;
  readonly url: string;
  readonly title: string;
  /** `YYYY-MM-DD` (UTC). */
  readonly publishedAt: string;
  /** Instante exacto de publicación (ISO 8601, UTC): permite saber a qué hora se publicó sin que el usuario la escriba. */
  readonly publishedAtIso?: string;
  readonly views: number | null;
  readonly likes: number | null;
  readonly comments: number | null;
  readonly shares: number | null;
  readonly saves: number | null;
  readonly reach: number | null;
}

export type SourceState = 'ok' | 'sin-configurar' | 'sin-autorizar' | 'error';

export interface Snapshot {
  readonly version: 1;
  /** Cuándo terminó la recogida (ISO 8601 UTC). */
  readonly updatedAt: string;
  readonly sources: Readonly<Record<Platform, { readonly state: SourceState; readonly message: string | null }>>;
  readonly items: readonly SnapshotItem[];
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class SourceError extends Error {
  constructor(
    message: string,
    readonly state: SourceState = 'error',
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

const DAY_MS = 86_400_000;
const DEFAULT_MAX_ITEMS = 20;
const HARD_MAX_ITEMS = 25; // 1 lista + 1 insights por publicación + renovaciones < 50 peticiones (límite del plan gratuito)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function maxItems(env: Pick<Env, 'MAX_ITEMS'>): number {
  const n = Number(env.MAX_ITEMS);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, HARD_MAX_ITEMS) : DEFAULT_MAX_ITEMS;
}

const cleanTitle = (raw: string, fallback: string): string => {
  const t = raw.replace(/\s+/g, ' ').trim().slice(0, 120);
  return t === '' ? fallback : t;
};

async function readJson(res: Response, what: string): Promise<unknown> {
  const text = await res.text();
  let body: unknown;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch (error) {
    console.warn(`${what}: respuesta no es JSON`, error);
    throw new SourceError(`${what}: respuesta no válida (HTTP ${String(res.status)}).`);
  }
  if (!res.ok) {
    const detail = isRecord(body) && isRecord(body['error']) ? str(body['error']['message']) : '';
    throw new SourceError(`${what}: HTTP ${String(res.status)}${detail === '' ? '' : ` — ${detail}`}`);
  }
  return body;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Instagram (graph.instagram.com, «Instagram API con inicio de sesión de Instagram»; permisos instagram_business_basic y _manage_insights)

const IG_TOKEN_KEY = 'ig_token';
const IG_TOKEN_AT_KEY = 'ig_token_refreshed_at';
const IG_REFRESH_EVERY_MS = 7 * DAY_MS; // el token dura 60 días; se renueva cada semana (la API exige que tenga ≥ 24 h)

/** Devuelve el token vigente y lo renueva cuando toca. */
export async function instagramToken(env: Env, fetchFn: FetchFn, now: number): Promise<string> {
  const stored = await env.STATS.get(IG_TOKEN_KEY);
  const token = stored ?? env.IG_TOKEN ?? '';
  if (token === '') throw new SourceError('Falta el secreto IG_TOKEN.', 'sin-configurar');
  const at = Number(await env.STATS.get(IG_TOKEN_AT_KEY));
  if (Number.isFinite(at) && at > 0 && now - at < IG_REFRESH_EVERY_MS) return token;
  try {
    const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`;
    const body = await readJson(await fetchFn(url), 'Renovar el token de Instagram');
    const fresh = isRecord(body) ? str(body['access_token']) : '';
    if (fresh === '') throw new SourceError('Renovar el token de Instagram: la respuesta no trae token.');
    await env.STATS.put(IG_TOKEN_KEY, fresh);
    await env.STATS.put(IG_TOKEN_AT_KEY, String(now));
    return fresh;
  } catch (error) {
    // Si no se pudo renovar pero aún no ha caducado, se sigue con el actual; la siguiente consulta dirá si ya no vale.
    console.warn('No se pudo renovar el token de Instagram', error);
    if (at === 0 || Number.isNaN(at)) await env.STATS.put(IG_TOKEN_AT_KEY, String(now - IG_REFRESH_EVERY_MS + DAY_MS));
    return token;
  }
}

export async function collectInstagram(env: Env, fetchFn: FetchFn, now: number): Promise<SnapshotItem[]> {
  const token = await instagramToken(env, fetchFn, now);
  const version = env.IG_API_VERSION ?? 'v26.0';
  const limit = maxItems(env);
  const base = `https://graph.instagram.com/${version}`;
  const listUrl = `${base}/me/media?fields=id,caption,permalink,timestamp,like_count,comments_count&limit=${String(limit)}&access_token=${encodeURIComponent(token)}`;
  const list = await readJson(await fetchFn(listUrl), 'Lista de publicaciones de Instagram');
  const data = isRecord(list) && Array.isArray(list['data']) ? (list['data'] as unknown[]) : [];
  const items: SnapshotItem[] = [];
  for (const raw of data.slice(0, limit)) {
    if (!isRecord(raw)) continue;
    const id = str(raw['id']);
    const url = str(raw['permalink']);
    const stamp = Date.parse(str(raw['timestamp']));
    if (id === '' || url === '' || Number.isNaN(stamp)) continue;
    const insights = await instagramInsights(base, id, token, fetchFn);
    items.push({
      platform: 'instagram',
      url,
      title: cleanTitle(str(raw['caption']), 'Publicación de Instagram'),
      publishedAt: isoDay(stamp),
      publishedAtIso: new Date(stamp).toISOString(),
      views: insights['views'] ?? null,
      likes: num(raw['like_count']),
      comments: num(raw['comments_count']),
      shares: insights['shares'] ?? null,
      saves: insights['saved'] ?? null,
      reach: insights['reach'] ?? null,
    });
  }
  return items;
}

/** Contadores de una publicación. Si la API no los da (publicación en álbum, muy reciente…), devuelve vacío: nunca se inventan ceros. */
async function instagramInsights(base: string, id: string, token: string, fetchFn: FetchFn): Promise<Partial<Record<string, number>>> {
  const url = `${base}/${id}/insights?metric=views,reach,saved,shares&access_token=${encodeURIComponent(token)}`;
  try {
    const body = await readJson(await fetchFn(url), `Insights de la publicación ${id}`);
    const out: Partial<Record<string, number>> = {};
    const rows = isRecord(body) && Array.isArray(body['data']) ? (body['data'] as unknown[]) : [];
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const values = Array.isArray(row['values']) ? (row['values'] as unknown[]) : [];
      const first = values[0];
      const value = isRecord(first) ? num(first['value']) : isRecord(row['total_value']) ? num(row['total_value']['value']) : null;
      if (value !== null) out[str(row['name'])] = value;
    }
    return out;
  } catch (error) {
    if (error instanceof SourceError) {
      console.warn(error.message);
      return {};
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// TikTok (Display API v2, scope video.list)

const TT_AUTH_KEY = 'tt_auth';
const TT_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';

interface TikTokAuth {
  readonly access: string;
  readonly accessExpiresAt: number;
  readonly refresh: string;
  readonly refreshExpiresAt: number;
}

function parseTikTokAuth(raw: string | null): TikTokAuth | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!isRecord(v)) return null;
    const a = { access: str(v['access']), accessExpiresAt: Number(v['accessExpiresAt']), refresh: str(v['refresh']), refreshExpiresAt: Number(v['refreshExpiresAt']) };
    return a.refresh !== '' && Number.isFinite(a.accessExpiresAt) && Number.isFinite(a.refreshExpiresAt) ? a : null;
  } catch (error) {
    console.warn('Datos de TikTok ilegibles en el KV', error);
    return null;
  }
}

function authFromTokenResponse(body: unknown, now: number): TikTokAuth {
  if (!isRecord(body) || str(body['access_token']) === '' || str(body['refresh_token']) === '') {
    const why = isRecord(body) ? str(body['error_description']) || str(body['error']) : '';
    throw new SourceError(`TikTok no devolvió tokens${why === '' ? '' : ` (${why})`}.`);
  }
  return {
    access: str(body['access_token']),
    accessExpiresAt: now + (num(body['expires_in']) ?? 3600) * 1000,
    refresh: str(body['refresh_token']),
    refreshExpiresAt: now + (num(body['refresh_expires_in']) ?? 365 * 86400) * 1000,
  };
}

async function tikTokTokenRequest(env: Env, fetchFn: FetchFn, params: Record<string, string>): Promise<unknown> {
  const form = new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY ?? '', client_secret: env.TIKTOK_CLIENT_SECRET ?? '', ...params });
  const res = await fetchFn(TT_TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  return readJson(res, 'Token de TikTok');
}

export async function tikTokAccessToken(env: Env, fetchFn: FetchFn, now: number): Promise<string> {
  if ((env.TIKTOK_CLIENT_KEY ?? '') === '' || (env.TIKTOK_CLIENT_SECRET ?? '') === '') throw new SourceError('Faltan los secretos TIKTOK_CLIENT_KEY y TIKTOK_CLIENT_SECRET.', 'sin-configurar');
  const auth = parseTikTokAuth(await env.STATS.get(TT_AUTH_KEY));
  if (auth === null) throw new SourceError('TikTok aún no está autorizado: abre /tiktok/login?key=… una vez.', 'sin-autorizar');
  if (auth.accessExpiresAt - now > 5 * 60_000) return auth.access;
  if (auth.refreshExpiresAt <= now) throw new SourceError('La autorización de TikTok caducó: vuelve a abrir /tiktok/login?key=….', 'sin-autorizar');
  const next = authFromTokenResponse(await tikTokTokenRequest(env, fetchFn, { grant_type: 'refresh_token', refresh_token: auth.refresh }), now);
  await env.STATS.put(TT_AUTH_KEY, JSON.stringify(next)); // el refresh_token puede cambiar: se guarda siempre el nuevo
  return next.access;
}

const TT_FIELDS = 'id,title,video_description,create_time,share_url,view_count,like_count,comment_count,share_count';

export async function collectTikTok(env: Env, fetchFn: FetchFn, now: number): Promise<SnapshotItem[]> {
  const token = await tikTokAccessToken(env, fetchFn, now);
  const limit = maxItems(env);
  const items: SnapshotItem[] = [];
  let cursor: number | null = null;
  for (let page = 0; page < 3 && items.length < limit; page += 1) {
    const body: { max_count: number; cursor?: number } = { max_count: Math.min(20, limit - items.length) };
    if (cursor !== null) body.cursor = cursor;
    const res = await fetchFn(`https://open.tiktokapis.com/v2/video/list/?fields=${TT_FIELDS}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await readJson(res, 'Lista de vídeos de TikTok');
    const data = isRecord(json) && isRecord(json['data']) ? json['data'] : null;
    const errCode = isRecord(json) && isRecord(json['error']) ? str(json['error']['code']) : 'ok';
    if (data === null || (errCode !== 'ok' && errCode !== '')) throw new SourceError(`Lista de vídeos de TikTok: ${errCode === '' ? 'respuesta inesperada' : errCode}.`);
    const videos = Array.isArray(data['videos']) ? (data['videos'] as unknown[]) : [];
    for (const v of videos) {
      if (!isRecord(v)) continue;
      const created = num(v['create_time']);
      const url = str(v['share_url']);
      if (created === null || url === '') continue;
      items.push({
        platform: 'tiktok',
        url,
        title: cleanTitle(str(v['title']) || str(v['video_description']), 'Vídeo de TikTok'),
        publishedAt: isoDay(created * 1000),
        publishedAtIso: new Date(created * 1000).toISOString(),
        views: num(v['view_count']),
        likes: num(v['like_count']),
        comments: num(v['comment_count']),
        shares: num(v['share_count']),
        saves: null, // la API de TikTok no da «guardados»
        reach: null,
      });
    }
    if (data['has_more'] !== true) break;
    cursor = num(data['cursor']);
    if (cursor === null) break;
  }
  return items.slice(0, limit);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Recogida y almacenamiento

const SNAPSHOT_KEY = 'snapshot';

export function parseStoredSnapshot(raw: string | null): Snapshot | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return isRecord(v) && v['version'] === 1 && Array.isArray(v['items']) && isRecord(v['sources']) && typeof v['updatedAt'] === 'string' ? (v as unknown as Snapshot) : null;
  } catch (error) {
    console.warn('Instantánea ilegible en el KV', error);
    return null;
  }
}

/** Recoge ambas plataformas. Si una falla, conserva lo último bueno de esa plataforma y lo indica en `sources`. */
export async function collect(env: Env, fetchFn: FetchFn, now: number = Date.now()): Promise<Snapshot> {
  const previous = parseStoredSnapshot(await env.STATS.get(SNAPSHOT_KEY));
  const run = async (platform: Platform, job: () => Promise<SnapshotItem[]>): Promise<{ items: readonly SnapshotItem[]; state: SourceState; message: string | null }> => {
    try {
      return { items: await job(), state: 'ok', message: null };
    } catch (error) {
      const state = error instanceof SourceError ? error.state : 'error';
      const message = error instanceof Error ? error.message : 'Error desconocido';
      console.warn(`Fallo al recoger ${platform}`, error);
      return { items: previous?.items.filter((i) => i.platform === platform) ?? [], state, message };
    }
  };
  const ig = await run('instagram', () => collectInstagram(env, fetchFn, now));
  const tt = await run('tiktok', () => collectTikTok(env, fetchFn, now));
  const snapshot: Snapshot = {
    version: 1,
    updatedAt: new Date(now).toISOString(),
    sources: { instagram: { state: ig.state, message: ig.message }, tiktok: { state: tt.state, message: tt.message } },
    items: [...ig.items, ...tt.items],
  };
  await env.STATS.put(SNAPSHOT_KEY, JSON.stringify(snapshot));
  return snapshot;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Sincronización entre dispositivos (móvil ⇄ ordenador): `POST /sync`
//
// El Worker guarda UN documento en KV con todos los elementos del usuario (fichas de vídeo, publicado, programado…), cada uno con la
// marca de tiempo de su último cambio. Cada dispositivo envía sólo lo que ha cambiado desde la última vez y recibe lo que cambió en los
// demás. Gana el cambio más reciente por elemento; los borrados se guardan como «lápidas». No interpreta los datos: sólo los guarda.

export const SYNC_KEY = 'sync_doc';
export const SYNC_COLLECTIONS: readonly string[] = ['videos', 'published', 'scheduled', 'downloaded', 'stats', 'imported', 'crests'];
export const MAX_SYNC_BYTES = 20_000_000;
export const MAX_SYNC_ENTRY_BYTES = 2_000_000;
export const MAX_SYNC_CHANGES = 5_000;
const TOMBSTONE_TTL_MS = 365 * DAY_MS;
const FUTURE_SLACK_MS = DAY_MS;

export interface SyncEntry {
  /** Instante del último cambio (ms). */
  readonly t: number;
  readonly d?: true;
  readonly v?: unknown;
  /** Revisión del documento en la que cambió por última vez. */
  readonly r: number;
}

export interface SyncDoc {
  readonly rev: number;
  readonly entries: Readonly<Record<string, SyncEntry>>;
}

export interface SyncReply {
  readonly rev: number;
  /** Hora del servidor (ms): el dispositivo la usa para corregir un reloj mal puesto. */
  readonly now: number;
  readonly entries: Readonly<Record<string, { readonly t: number; readonly d?: true; readonly v?: unknown }>>;
}

export type SyncResult = { readonly ok: true; readonly doc: SyncDoc; readonly reply: SyncReply; readonly changed: boolean } | { readonly ok: false; readonly status: number; readonly error: string };

export function parseSyncDoc(raw: string | null): SyncDoc {
  if (raw === null) return { rev: 0, entries: {} };
  try {
    const data: unknown = JSON.parse(raw);
    if (isRecord(data) && typeof data['rev'] === 'number' && isRecord(data['entries'])) return { rev: data['rev'], entries: data['entries'] as Readonly<Record<string, SyncEntry>> };
  } catch (error) {
    console.warn('Documento de sincronización dañado: se empieza de cero', error);
  }
  return { rev: 0, entries: {} };
}

const SYNC_KEY_RE = /^[a-z]+\/[^\s].{0,199}$/;

/** Fusiona los cambios de un dispositivo con el documento. Función pura: no toca KV. */
export function syncMerge(doc: SyncDoc, body: unknown, now: number): SyncResult {
  if (!isRecord(body) || typeof body['since'] !== 'number' || !Number.isFinite(body['since']) || !isRecord(body['changes'])) return { ok: false, status: 400, error: 'Petición no válida: faltan `since` y `changes`.' };
  const since = body['since'];
  const changes = Object.entries(body['changes']);
  if (changes.length > MAX_SYNC_CHANGES) return { ok: false, status: 413, error: `Demasiados cambios de una vez (máximo ${String(MAX_SYNC_CHANGES)}).` };
  const nextRev = doc.rev + 1;
  const entries: Record<string, SyncEntry> = { ...doc.entries };
  const accepted = new Set<string>();
  for (const [key, raw] of changes) {
    const collection = key.slice(0, key.indexOf('/'));
    if (!SYNC_KEY_RE.test(key) || !SYNC_COLLECTIONS.includes(collection)) return { ok: false, status: 400, error: `Clave no permitida: ${key.slice(0, 40)}` };
    if (!isRecord(raw) || typeof raw['t'] !== 'number' || !Number.isFinite(raw['t']) || raw['t'] <= 0 || raw['t'] > now + FUTURE_SLACK_MS) return { ok: false, status: 400, error: `Marca de tiempo no válida en ${key.slice(0, 40)}` };
    const deleted = raw['d'] === true;
    if (!deleted && raw['v'] === undefined) return { ok: false, status: 400, error: `Falta el valor de ${key.slice(0, 40)}` };
    if (!deleted && JSON.stringify(raw['v']).length > MAX_SYNC_ENTRY_BYTES) return { ok: false, status: 413, error: `${key.slice(0, 40)} es demasiado grande (máximo ${String(MAX_SYNC_ENTRY_BYTES / 1_000_000)} MB).` };
    const existing = entries[key];
    if (existing !== undefined && existing.t >= raw['t']) continue; // ya hay algo igual de reciente o más: se queda lo del servidor
    entries[key] = deleted ? { t: raw['t'], d: true, r: nextRev } : { t: raw['t'], v: raw['v'], r: nextRev };
    accepted.add(key);
  }
  // Las lápidas muy antiguas se eliminan para que el documento no crezca sin fin.
  for (const [key, e] of Object.entries(entries)) if (e.d === true && now - e.t > TOMBSTONE_TTL_MS && !accepted.has(key)) Reflect.deleteProperty(entries, key);
  const changed = accepted.size > 0;
  const next: SyncDoc = changed ? { rev: nextRev, entries } : { rev: doc.rev, entries };
  if (changed && JSON.stringify(next).length > MAX_SYNC_BYTES) return { ok: false, status: 413, error: `Se superó el tamaño máximo de la sincronización (${String(MAX_SYNC_BYTES / 1_000_000)} MB).` };
  const out: Record<string, { t: number; d?: true; v?: unknown }> = {};
  for (const [key, e] of Object.entries(next.entries)) {
    if (e.r <= since || accepted.has(key)) continue;
    out[key] = e.d === true ? { t: e.t, d: true } : { t: e.t, v: e.v };
  }
  return { ok: true, doc: next, reply: { rev: next.rev, now, entries: out }, changed };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// HTTP

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const MIN_KEY_LENGTH = 24;

function authorized(request: Request, env: Env, url: URL): boolean {
  if (env.STATS_KEY.length < MIN_KEY_LENGTH) return false;
  const header = request.headers.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : (url.searchParams.get('key') ?? '');
  return timingSafeEqual(given, env.STATS_KEY);
}

function cors(env: Env): Record<string, string> {
  return {
    'access-control-allow-origin': env.ALLOWED_ORIGIN ?? '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    vary: 'origin',
  };
}

const json = (env: Env, body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors(env) } });

const page = (title: string, text: string, status = 200): Response =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>${title}</h1><p>${text}</p>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });

export async function handleRequest(request: Request, env: Env, fetchFn: FetchFn = (i, init) => fetch(i, init), now: number = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });

  if (url.pathname === '/tiktok/login' && request.method === 'GET') {
    if (!authorized(request, env, url)) return page('No autorizado', 'Falta la clave correcta (?key=…).', 401);
    if ((env.TIKTOK_CLIENT_KEY ?? '') === '') return page('Falta configurar TikTok', 'Añade el secreto TIKTOK_CLIENT_KEY.', 400);
    const state = crypto.randomUUID();
    await env.STATS.put(`tt_state_${state}`, '1', { expirationTtl: 600 });
    const redirect = `${url.origin}/tiktok/callback`;
    const target = `https://www.tiktok.com/v2/auth/authorize/?client_key=${encodeURIComponent(env.TIKTOK_CLIENT_KEY ?? '')}&scope=${encodeURIComponent('user.info.basic,video.list')}&response_type=code&redirect_uri=${encodeURIComponent(redirect)}&state=${state}`;
    return new Response(null, { status: 302, headers: { location: target, 'cache-control': 'no-store' } });
  }

  if (url.pathname === '/tiktok/callback' && request.method === 'GET') {
    const state = url.searchParams.get('state') ?? '';
    const code = url.searchParams.get('code') ?? '';
    if (state === '' || (await env.STATS.get(`tt_state_${state}`)) === null) return page('Enlace caducado', 'Vuelve a abrir /tiktok/login?key=… para empezar de nuevo.', 400);
    await env.STATS.delete(`tt_state_${state}`);
    if (code === '') return page('TikTok no concedió el permiso', url.searchParams.get('error_description') ?? 'No se recibió ningún código.', 400);
    try {
      const auth = authFromTokenResponse(await tikTokTokenRequest(env, fetchFn, { grant_type: 'authorization_code', code, redirect_uri: `${url.origin}/tiktok/callback` }), now);
      await env.STATS.put(TT_AUTH_KEY, JSON.stringify(auth));
    } catch (error) {
      console.warn('Fallo al autorizar TikTok', error);
      return page('No se pudo conectar TikTok', error instanceof Error ? error.message : 'Error desconocido', 502);
    }
    return page('TikTok conectado', 'Ya puedes cerrar esta pestaña. Las estadísticas se actualizarán solas cada 30 minutos.');
  }

  if (url.pathname === '/stats' && request.method === 'GET') {
    if (!authorized(request, env, url)) return json(env, { error: 'No autorizado' }, 401);
    const snapshot = parseStoredSnapshot(await env.STATS.get(SNAPSHOT_KEY));
    return snapshot === null ? json(env, { error: 'Todavía no hay datos: espera a la primera ejecución o llama a POST /refresh.' }, 404) : json(env, snapshot);
  }

  if (url.pathname === '/sync' && request.method === 'POST') {
    if (!authorized(request, env, url)) return json(env, { error: 'No autorizado' }, 401);
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      console.warn('Cuerpo de /sync no válido', error);
      return json(env, { error: 'El cuerpo debe ser JSON.' }, 400);
    }
    const result = syncMerge(parseSyncDoc(await env.STATS.get(SYNC_KEY)), body, now);
    if (!result.ok) return json(env, { error: result.error }, result.status);
    if (result.changed) await env.STATS.put(SYNC_KEY, JSON.stringify(result.doc));
    return json(env, result.reply);
  }

  if (url.pathname === '/refresh' && request.method === 'POST') {
    if (!authorized(request, env, url)) return json(env, { error: 'No autorizado' }, 401);
    const last = parseStoredSnapshot(await env.STATS.get(SNAPSHOT_KEY));
    // Para no agotar las cuotas de las APIs: como mucho una recogida manual por minuto.
    if (last !== null && now - Date.parse(last.updatedAt) < 60_000) return json(env, last);
    return json(env, await collect(env, fetchFn, now));
  }

  return json(env, { error: 'No encontrado' }, 404);
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handleRequest(request, env),
  scheduled: async (_event: unknown, env: Env): Promise<void> => {
    await collect(env, (i, init) => fetch(i, init));
  },
};
