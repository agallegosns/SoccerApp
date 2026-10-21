import type { Match, RealScore, TimeKind } from '../../data/types.ts';
import type { Pace, Score } from '../../engine/index.ts';
import { sanitizeOptions, type VideoOptions } from '../simulation/options.ts';
import type { VideoStyle } from '../simulation/renderers.ts';

/**
 * Ficha de un vídeo exportado. Guarda los PARÁMETROS (no el MP4, que ocuparía decenas de MB): como el motor es determinista,
 * con estos mismos parámetros se regenera exactamente el mismo vídeo. El marcador es ficticio; el resultado real, si lo hay, va dentro de `match`.
 */
export interface VideoRecord {
  readonly id: string;
  readonly match: Match;
  readonly seed: number;
  readonly style: VideoStyle;
  readonly pace: Pace;
  /** Marcador fijado por el usuario o `null` si lo decidió la semilla. */
  readonly fixedScore: Score | null;
  /** Marcador ficticio resultante. */
  readonly score: Score;
  readonly options: VideoOptions;
  readonly fileName: string;
  readonly bytes: number;
  readonly durationSeconds: number;
  /** Instante (ms desde 1970) de la última exportación. */
  readonly createdAt: number;
}

export type VideoParams = Omit<VideoRecord, 'id' | 'bytes' | 'durationSeconds' | 'createdAt' | 'fileName'>;

export const MAX_VIDEOS = 200;

/** Hash FNV-1a de 32 bits con dos semillas → 16 caracteres hexadecimales, aptos para una URL. */
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

/** Mismos parámetros ⇒ mismo id: volver a exportar el mismo vídeo actualiza su ficha en lugar de duplicarla. */
export function videoId(p: VideoParams): string {
  const fixed = p.fixedScore === null ? 'r' : `${String(p.fixedScore.home)}-${String(p.fixedScore.away)}`;
  return hash64([p.match.id, String(p.seed), p.style, p.pace, fixed, JSON.stringify(p.options)].join('|'));
}

export function buildRecord(params: VideoParams, extra: { fileName: string; bytes: number; durationSeconds: number }, now: number = Date.now()): VideoRecord {
  return { ...params, id: videoId(params), ...extra, createdAt: now };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const TIME_KINDS: readonly TimeKind[] = ['league-local', 'utc'];

function toScore(v: unknown): Score | null {
  return isRecord(v) && isInt(v['home']) && isInt(v['away']) ? { home: v['home'], away: v['away'] } : null;
}

function toRealScore(v: unknown): RealScore | null {
  if (!isRecord(v) || !isInt(v['home']) || !isInt(v['away'])) return null;
  return typeof v['note'] === 'string' ? { home: v['home'], away: v['away'], note: v['note'] } : { home: v['home'], away: v['away'] };
}

function toMatch(v: unknown): Match | null {
  if (!isRecord(v)) return null;
  const { id, leagueId, competition, round, date, time, timeKind, home, away, realScore } = v;
  const kind = TIME_KINDS.find((k) => k === timeKind);
  if (
    typeof id !== 'string' || typeof leagueId !== 'string' || typeof competition !== 'string' || typeof round !== 'string' ||
    typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof home !== 'string' || typeof away !== 'string' ||
    kind === undefined || (time !== null && typeof time !== 'string')
  ) {
    return null;
  }
  return { id, leagueId, competition, round, date, time: time, timeKind: kind, home, away, realScore: realScore === null ? null : toRealScore(realScore) };
}

/** Valida una ficha guardada (cualquier dato raro → se descarta, nunca rompe la app). */
export function toVideoRecord(v: unknown): VideoRecord | null {
  if (!isRecord(v)) return null;
  const match = toMatch(v['match']);
  const score = toScore(v['score']);
  const style: VideoStyle | null = v['style'] === 'arena' || v['style'] === 'tactical' ? v['style'] : null;
  const pace: Pace | null = v['pace'] === 'fast' || v['pace'] === 'normal' ? v['pace'] : null;
  const fixedScore = v['fixedScore'] === null ? null : toScore(v['fixedScore']);
  if (
    match === null || score === null || style === null || pace === null || !isInt(v['seed']) || typeof v['fileName'] !== 'string' ||
    !isFiniteNumber(v['bytes']) || !isFiniteNumber(v['durationSeconds']) || !isFiniteNumber(v['createdAt']) || (v['fixedScore'] !== null && fixedScore === null)
  ) {
    return null;
  }
  const params: VideoParams = { match, seed: v['seed'], style, pace, fixedScore, score, options: sanitizeOptions(v['options']) };
  return { ...params, id: videoId(params), fileName: v['fileName'], bytes: v['bytes'], durationSeconds: v['durationSeconds'], createdAt: v['createdAt'] };
}

export function toVideoRecords(v: unknown): VideoRecord[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: VideoRecord[] = [];
  for (const item of v as unknown[]) {
    const r = toVideoRecord(item);
    if (r !== null && !seen.has(r.id)) {
      seen.add(r.id);
      out.push(r);
    }
  }
  return out.slice(0, MAX_VIDEOS);
}

/** Hashtag a partir de un nombre: sin espacios, acentos ni signos. */
export function hashtag(name: string): string {
  const clean = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim();
  return clean === '' ? '' : `#${clean.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')}`;
}

/** Descripción lista para pegar al publicar. Sin prometer nada: es una simulación ficticia. */
export function captionFor(r: VideoRecord): string {
  const tags = ['#Fútbol', hashtag(r.match.home), hashtag(r.match.away), hashtag(r.match.competition.replace(/\s*\d{4}[-/]\d{2,4}\s*$/, ''))].filter((t) => t !== '');
  return [
    `¿Quién gana? ${r.match.home} vs ${r.match.away} (${r.match.competition}, ${r.match.round}).`,
    `Simulación ficticia: ${String(r.score.home)}–${String(r.score.away)}. No es una predicción. Comenta tu marcador.`,
    '',
    [...new Set(tags)].join(' '),
  ].join('\n');
}

export interface VideoFilter {
  readonly text: string;
  readonly competition: string;
  readonly downloaded: 'all' | 'yes' | 'no';
}

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function filterVideos(videos: readonly VideoRecord[], f: VideoFilter, downloaded: ReadonlySet<string>): VideoRecord[] {
  const q = fold(f.text.trim());
  return videos.filter((v) => {
    if (f.competition !== '' && v.match.competition !== f.competition) return false;
    if (f.downloaded === 'yes' && !downloaded.has(v.match.id)) return false;
    if (f.downloaded === 'no' && downloaded.has(v.match.id)) return false;
    return q === '' || fold(`${v.match.home} ${v.match.away} ${v.match.competition} ${v.match.round} ${String(v.seed)}`).includes(q);
  });
}

export const formatBytes = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`;

export function formatStamp(ms: number): string {
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}
