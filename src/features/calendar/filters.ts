import { kickoffOf, slug } from '../../data/dates.ts';
import type { Match } from '../../data/types.ts';

export type Scope = 'upcoming' | 'all' | 'played';

export interface Filters {
  readonly query: string;
  /** `YYYY-MM-DD` o cadena vacía (sin límite). */
  readonly from: string;
  readonly to: string;
  readonly scope: Scope;
}

export const DEFAULT_FILTERS: Filters = { query: '', from: '', to: '', scope: 'upcoming' };

export interface DayGroup {
  readonly date: string;
  readonly matches: readonly Match[];
}

interface Positioned {
  readonly match: Match;
  readonly date: string;
  readonly time: string;
}

/** Filtra y ordena (próximos ascendente; jugados, del más reciente al más antiguo). */
export function filterMatches(
  matches: readonly Match[],
  filters: Filters,
  today: string,
  timeZone?: string,
): Match[] {
  const needle = slug(filters.query);
  const positioned: Positioned[] = [];
  for (const match of matches) {
    const k = kickoffOf(match, timeZone);
    if (filters.scope === 'upcoming' && k.date < today) continue;
    if (filters.scope === 'played' && k.date >= today) continue;
    if (filters.from !== '' && k.date < filters.from) continue;
    if (filters.to !== '' && k.date > filters.to) continue;
    if (needle !== '' && !slug(`${match.home} ${match.away} ${match.round}`).includes(needle)) continue;
    positioned.push({ match, date: k.date, time: k.time ?? '99:99' });
  }
  const dir = filters.scope === 'played' ? -1 : 1;
  positioned.sort((a, b) => dir * `${a.date} ${a.time} ${a.match.id}`.localeCompare(`${b.date} ${b.time} ${b.match.id}`));
  return positioned.map((p) => p.match);
}

/** Agrupa por día de visualización (ya convertido a la zona del usuario si procede). */
export function groupByDate(matches: readonly Match[], timeZone?: string): DayGroup[] {
  const groups: { date: string; matches: Match[] }[] = [];
  for (const match of matches) {
    const { date } = kickoffOf(match, timeZone);
    const last = groups.at(-1);
    if (last?.date === date) last.matches.push(match);
    else groups.push({ date, matches: [match] });
  }
  return groups;
}
