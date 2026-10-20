import type { Match } from './types.ts';

const pad = (n: number): string => String(n).padStart(2, '0');

/** Fecha de hoy `YYYY-MM-DD` en la zona horaria del navegador. */
export function todayLocal(now: Date = new Date()): string {
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export interface Kickoff {
  /** `YYYY-MM-DD` tal como debe mostrarse/agruparse. */
  readonly date: string;
  /** `HH:mm` o `null` si no hay hora. */
  readonly time: string | null;
  /** `true` si la hora se ha convertido a la zona del usuario. */
  readonly converted: boolean;
}

/**
 * Fecha y hora a mostrar. Los horarios `league-local` se devuelven sin convertir; los `utc` se
 * convierten a `timeZone` (por defecto, la del navegador).
 */
export function kickoffOf(match: Pick<Match, 'date' | 'time' | 'timeKind'>, timeZone?: string): Kickoff {
  if (match.timeKind === 'league-local' || match.time === null) {
    return { date: match.date, time: match.time, converted: false };
  }
  const instant = new Date(`${match.date}T${match.time}:00Z`);
  if (Number.isNaN(instant.getTime())) {
    return { date: match.date, time: match.time, converted: false };
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    ...(timeZone === undefined ? {} : { timeZone }),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
    converted: true,
  };
}

/** «martes, 20 de octubre de 2026» a partir de `YYYY-MM-DD` (sin depender de la zona del usuario). */
export function formatDateEs(date: string): string {
  const instant = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(instant.getTime())) return date;
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(instant);
}

/** Letras latinas que NFD no descompone (ø, æ, ß…): se transliteran para no perderlas en ids y nombres de archivo. */
const TRANSLITERATE: Readonly<Record<string, string>> = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', đ: 'd', ð: 'd', þ: 'th', ł: 'l', ı: 'i', ħ: 'h' };

/** Texto para nombres de archivo y ids: minúsculas, sin acentos, sólo `[a-z0-9-]`. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[øæœßđðþłıħ]/g, (c) => TRANSLITERATE[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
