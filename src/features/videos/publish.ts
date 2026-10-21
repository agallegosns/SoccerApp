import type { Match } from '../../data/types.ts';
import { platformLabel, type Platform, type Publication } from '../stats/model.ts';
import { hashtag, type VideoRecord } from './model.ts';

/**
 * Textos y recomendaciones para publicar. Todo sale de datos reales del partido (equipos, competición, hora) y de las métricas reales del
 * usuario. NO se puede medir qué hashtag o qué hora harán viral un vídeo: por eso los hashtags son los habituales del fútbol más los del
 * partido, y la hora es o bien un análisis de las métricas propias (con mínimos de muestra) o bien una franja orientativa, marcada como tal.
 */

function hashOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

const cleanCompetition = (c: string): string => c.replace(/\s*\d{4}[-/]\d{2,4}\s*$/, '');

/** Cinco hashtags únicos para la plataforma: los de los equipos y la competición primero, después populares del fútbol. */
export function hashtagsFor(match: Match, platform: Platform): string[] {
  const own = [hashtag(match.home), hashtag(match.away), hashtag(cleanCompetition(match.competition))];
  const popular: Record<Platform, string[]> = {
    tiktok: ['#Futbol', '#FutbolTikTok', '#fyp', '#ParaTi', '#Simulacion'],
    instagram: ['#Futbol', '#Reels', '#Football', '#FutbolEspana', '#Simulacion'],
  };
  const out: string[] = [];
  for (const tag of [...own, ...popular[platform]]) {
    if (tag === '' || out.some((o) => o.toLowerCase() === tag.toLowerCase())) continue;
    out.push(tag);
    if (out.length === 5) break;
  }
  return out;
}

const OPENERS: readonly ((m: Match, s: string) => string)[] = [
  (m, s) => `${m.home} vs ${m.away}: ${s} en esta simulación. ¿Lo ves así? Comenta tu marcador.`,
  (m, s) => `${m.home} vs ${m.away}. Simulación ficticia (${s}): ¿quién gana de verdad? Te leo.`,
  (m, s) => `Si ${m.home} y ${m.away} jugasen este partido... ${s}. Comenta tu marcador.`,
  (m, s) => `${m.home} vs ${m.away}, ${m.round}: así lo he simulado (${s}). ¿Qué marcador pones tú?`,
];

export const DESCRIPTION_VARIANTS = OPENERS.length;

/**
 * Descripción con estilo, del tipo «Barça vs Real Madrid», más los hashtags. La versión de partida es determinista por partido; `shift` rota a las siguientes.
 * Dice siempre que es una simulación ficticia: no es una predicción.
 */
export function descriptionFor(r: VideoRecord, platform: Platform, shift = 0): string {
  const variant = hashOf(r.match.id) + shift;
  const opener = OPENERS[((variant % OPENERS.length) + OPENERS.length) % OPENERS.length] ?? OPENERS[0];
  const score = `${String(r.score.home)}–${String(r.score.away)}`;
  const body = opener === undefined ? '' : opener(r.match, score);
  return [body, `${cleanCompetition(r.match.competition)} · simulación ficticia, no es una predicción.`, '', hashtagsFor(r.match, platform).join(' ')].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Hora recomendada

export interface Slot {
  readonly id: 'morning' | 'afternoon' | 'evening' | 'night';
  readonly label: string;
  readonly from: number;
  readonly to: number;
}

export const SLOTS: readonly Slot[] = [
  { id: 'morning', label: 'Mañana (06:00–12:00)', from: 6, to: 12 },
  { id: 'afternoon', label: 'Tarde (12:00–18:00)', from: 12, to: 18 },
  { id: 'evening', label: 'Noche temprana (18:00–22:00)', from: 18, to: 22 },
  { id: 'night', label: 'Madrugada (22:00–06:00)', from: 22, to: 30 },
];

export const MIN_POSTS_TOTAL = 8;
export const MIN_POSTS_PER_SLOT = 3;
/** Días mínimos desde la publicación hasta la última medición para que sus visualizaciones cuenten (una publicación reciente aún no ha «madurado»). */
export const MIN_AGE_DAYS = 3;

const slotOf = (hour: number): Slot | undefined => SLOTS.find((s) => (hour >= s.from && hour < s.to) || (s.id === 'night' && hour < 6));

function median(values: readonly number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? (v[mid] ?? 0) : ((v[mid - 1] ?? 0) + (v[mid] ?? 0)) / 2;
}

export interface TimeAnalysis {
  readonly slot: Slot;
  readonly medianViews: number;
  readonly posts: number;
  readonly totalPosts: number;
}

/**
 * Franja horaria (hora local del navegador) con más visualizaciones MEDIANAS entre tus publicaciones reales con hora conocida.
 * Devuelve `null` (no hay datos suficientes) si hay menos de 8 publicaciones maduras o ninguna franja tiene al menos 3.
 */
export function analyseBestSlot(publications: readonly Publication[], platform: Platform | 'all' = 'all'): TimeAnalysis | null {
  const bySlot = new Map<Slot['id'], number[]>();
  let total = 0;
  for (const p of publications) {
    if (platform !== 'all' && p.platform !== platform) continue;
    if (p.publishedAtIso === undefined) continue;
    const at = new Date(p.publishedAtIso);
    const last = p.measurements[p.measurements.length - 1];
    if (Number.isNaN(at.getTime()) || last === undefined) continue;
    if (Date.parse(`${last.date}T23:59:59`) - at.getTime() < MIN_AGE_DAYS * 86_400_000) continue;
    const slot = slotOf(at.getHours());
    if (slot === undefined) continue;
    bySlot.set(slot.id, [...(bySlot.get(slot.id) ?? []), last.views]);
    total += 1;
  }
  if (total < MIN_POSTS_TOTAL) return null;
  let best: TimeAnalysis | null = null;
  for (const slot of SLOTS) {
    const views = bySlot.get(slot.id) ?? [];
    if (views.length < MIN_POSTS_PER_SLOT) continue;
    const m = median(views);
    if (best === null || m > best.medianViews) best = { slot, medianViews: m, posts: views.length, totalPosts: total };
  }
  return best;
}

export interface TimeRecommendation {
  readonly kind: 'data' | 'orientative';
  readonly headline: string;
  readonly detail: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Hora recomendada para publicar el vídeo de un partido. Con datos suficientes: la franja que mejor ha funcionado en las métricas del usuario.
 * Si no: franja orientativa respecto al inicio del partido (cuando la conversación sobre él es mayor), marcada como orientativa.
 */
export function recommendTime(match: Match, publications: readonly Publication[], platform: Platform): TimeRecommendation {
  const analysis = analyseBestSlot(publications, platform) ?? analyseBestSlot(publications, 'all');
  if (analysis !== null) {
    return {
      kind: 'data',
      headline: analysis.slot.label,
      detail: `Según tus métricas reales: ${String(analysis.posts)} de tus ${String(analysis.totalPosts)} publicaciones salieron en esta franja y tuvieron la mediana más alta (${String(Math.round(analysis.medianViews))} visualizaciones). Es una tendencia de tus datos, no una garantía de viralidad.`,
    };
  }
  if (match.time !== null) {
    const [hh, mm] = match.time.split(':').map(Number);
    if (hh !== undefined && mm !== undefined && !Number.isNaN(hh) && !Number.isNaN(mm)) {
      const start = hh * 60 + mm;
      const fmt = (min: number): string => `${pad(Math.floor((((min % 1440) + 1440) % 1440) / 60))}:${pad((((min % 1440) + 1440) % 1440) % 60)}`;
      return {
        kind: 'orientative',
        headline: `${fmt(start - 120)}–${fmt(start - 30)} (hora del partido: ${match.time})`,
        detail: `Franja orientativa: las 2 horas previas al inicio, cuando se habla más del partido. No sale de tus datos (aún no hay suficientes publicaciones con métricas: hacen falta ${String(MIN_POSTS_TOTAL)} con ${String(MIN_AGE_DAYS)} días o más) y no garantiza viralidad. La hora es la que da la fuente del calendario.`,
      };
    }
  }
  return {
    kind: 'orientative',
    headline: 'Sin recomendación todavía',
    detail: `Este partido no tiene hora conocida y aún no hay suficientes publicaciones con métricas (hacen falta ${String(MIN_POSTS_TOTAL)} con ${String(MIN_AGE_DAYS)} días o más) para calcular tu mejor franja. No se inventa una hora.`,
  };
}

export { platformLabel };
