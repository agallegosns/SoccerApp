import { slug } from './dates.ts';
import type { Match, RealScore, TimeKind } from './types.ts';
import { DataError } from './types.ts';

export interface ParseContext {
  readonly leagueId: string;
  readonly competition: string;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const int = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) ? value : null);

export function matchId(leagueId: string, date: string, home: string, away: string): string {
  return `${leagueId}:${date}:${slug(home)}:${slug(away)}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function build(
  ctx: ParseContext,
  fields: {
    round: string;
    date: string;
    time: string | null;
    timeKind: TimeKind;
    home: string;
    away: string;
    realScore: RealScore | null;
  },
): Match {
  return {
    id: matchId(ctx.leagueId, fields.date, fields.home, fields.away),
    leagueId: ctx.leagueId,
    competition: ctx.competition,
    ...fields,
  };
}

function sortMatches(matches: Match[]): Match[] {
  return matches.sort((a, b) =>
    `${a.date} ${a.time ?? '99:99'} ${a.id}`.localeCompare(`${b.date} ${b.time ?? '99:99'} ${b.id}`),
  );
}

/** Garantiza ids únicos (p. ej. ida y vuelta el mismo día no ocurre, pero una fuente podría repetir). */
function dedupe(matches: Match[]): Match[] {
  const seen = new Map<string, number>();
  return matches.map((m) => {
    const n = seen.get(m.id) ?? 0;
    seen.set(m.id, n + 1);
    return n === 0 ? m : { ...m, id: `${m.id}#${String(n + 1)}` };
  });
}

function readScorePair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const home = int(value[0]);
  const away = int(value[1]);
  return home === null || away === null ? null : [home, away];
}

/** Formato de openfootball/football.json: `{ name, matches: [{ round, date, time?, team1, team2, score? }] }`. */
export function parseOpenFootballJson(data: unknown, ctx: ParseContext): Match[] {
  if (!isRecord(data) || !Array.isArray(data['matches'])) {
    throw new DataError('parse', 'El archivo no tiene el formato de openfootball (falta «matches»)');
  }
  const out: Match[] = [];
  for (const raw of data['matches'] as unknown[]) {
    if (!isRecord(raw)) continue;
    const date = str(raw['date']);
    const home = str(raw['team1']);
    const away = str(raw['team2']);
    if (date === null || home === null || away === null || !DATE_RE.test(date)) continue;
    const time = str(raw['time']);
    const score = isRecord(raw['score']) ? readScorePair(raw['score']['ft']) : null;
    out.push(
      build(ctx, {
        round: roundLabelEs(str(raw['round']) ?? 'Partido'),
        date,
        time: time !== null && TIME_RE.test(time) ? time : null,
        timeKind: 'league-local',
        home,
        away,
        realScore: score === null ? null : { home: score[0], away: score[1] },
      }),
    );
  }
  if (out.length === 0) throw new DataError('parse', 'El archivo no contiene ningún partido válido');
  return dedupe(sortMatches(out));
}

const MONTHS: Readonly<Record<string, number>> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

const iso = (year: number, month: number, day: number): string =>
  `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const ROUND_ES: Readonly<Record<string, string>> = {
  League: 'Fase de liga',
  Playoffs: 'Play-offs',
  Finals: 'Fase final',
  Qualifying: 'Clasificación',
};

function roundLabelEs(raw: string): string {
  return raw
    .split(',')
    .map((part) => part.trim())
    .map((part) =>
      part
        .replace(/^Matchday (\d+)$/, 'Jornada $1')
        .replace(/^Round of 16$/, 'Octavos de final')
        .replace(/^Quarterfinals$/, 'Cuartos de final')
        .replace(/^Semifinals$/, 'Semifinales')
        .replace(/^Final$/, 'Final'),
    )
    .map((part) => ROUND_ES[part] ?? part)
    .join(' · ');
}

function parseTxtScore(rest: string | undefined): RealScore | null {
  if (rest === undefined) return null;
  const pen = /^(\d+)-(\d+)\s+pen\.\s+(\d+)-(\d+)\s+a\.e\.t\./.exec(rest);
  if (pen !== null) {
    return {
      home: Number(pen[3]),
      away: Number(pen[4]),
      note: `Tras prórroga; penaltis ${pen[1] ?? ''}-${pen[2] ?? ''}`,
    };
  }
  const aet = /^(\d+)-(\d+)\s+a\.e\.t\./.exec(rest);
  if (aet !== null) return { home: Number(aet[1]), away: Number(aet[2]), note: 'Tras prórroga' };
  const plain = /^(\d+)-(\d+)(?:\s|$)/.exec(rest);
  return plain === null ? null : { home: Number(plain[1]), away: Number(plain[2]) };
}

const cleanTeam = (name: string): string => name.replace(/\s+\([A-Z]{3}\)\s*$/, '').trim();

/**
 * Formato Football.TXT de openfootball (usado por europe-champions-league):
 * cabeceras `▪ Ronda`, líneas de fecha (`Tue Sep 16 2025`, el año sólo aparece al principio) y
 * partidos `HH:mm Equipo (PAÍS) v Equipo (PAÍS)  marcador`. La hora se hereda dentro del mismo día.
 */
export function parseFootballTxt(text: string, ctx: ParseContext): Match[] {
  const out: Match[] = [];
  let round = 'Partido';
  let year: number | null = null;
  let lastMonth = 0;
  let date: string | null = null;
  let time: string | null = null;

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.startsWith('#') || line.startsWith('=')) continue;
    if (line.startsWith('▪')) {
      round = roundLabelEs(line.slice(1).trim());
      continue;
    }
    const dateLine = /^\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Z][a-z]{2})\s+(\d{1,2})(?:\s+(\d{4}))?\s*$/.exec(line);
    if (dateLine !== null) {
      const month = MONTHS[dateLine[1] ?? ''];
      const day = Number(dateLine[2]);
      if (month === undefined) throw new DataError('parse', `Mes no reconocido en la línea: ${line.trim()}`);
      if (dateLine[3] !== undefined) year = Number(dateLine[3]);
      else if (year !== null && month < lastMonth) year += 1;
      if (year === null) throw new DataError('parse', 'La primera fecha del archivo debe incluir el año');
      lastMonth = month;
      date = iso(year, month, day);
      time = null;
      continue;
    }
    const matchLine = /^\s+(?:(\d{1,2}:\d{2})\s+)?(\S.*?) v (\S.*?)(?:\s{2,}(.*))?\s*$/.exec(line);
    if (matchLine === null) continue;
    if (date === null) throw new DataError('parse', `Partido sin fecha previa: ${line.trim()}`);
    if (matchLine[1] !== undefined) time = matchLine[1].padStart(5, '0');
    let away = matchLine[3] ?? '';
    let rest = matchLine[4];
    const glued = /^(.*\S)\s(\d+-\d+.*)$/.exec(away);
    if (rest === undefined && glued !== null) {
      away = glued[1] ?? away;
      rest = glued[2];
    }
    out.push(
      build(ctx, {
        round,
        date,
        time,
        timeKind: 'league-local',
        home: cleanTeam(matchLine[2] ?? ''),
        away: cleanTeam(away),
        realScore: parseTxtScore(rest),
      }),
    );
  }
  if (out.length === 0) throw new DataError('parse', 'El archivo no contiene ningún partido válido');
  return dedupe(sortMatches(out));
}

function splitUtc(iso8601: string): { date: string; time: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(iso8601);
  return m === null || m[1] === undefined || m[2] === undefined ? null : { date: m[1], time: m[2] };
}

const STAGE_ES: Readonly<Record<string, string>> = {
  LEAGUE_STAGE: 'Fase de liga',
  PLAYOFFS: 'Play-offs',
  LAST_16: 'Octavos de final',
  QUARTER_FINALS: 'Cuartos de final',
  SEMI_FINALS: 'Semifinales',
  FINAL: 'Final',
  GROUP_STAGE: 'Fase de grupos',
  REGULAR_SEASON: 'Liga',
};

/** football-data.org v4 (`/competitions/{id}/matches`): fechas en UTC. */
export function parseFootballDataOrg(data: unknown, ctx: ParseContext): Match[] {
  if (!isRecord(data) || !Array.isArray(data['matches']) || !(isRecord(data['matches'][0]) && 'utcDate' in data['matches'][0])) {
    throw new DataError('parse', 'El archivo no tiene el formato de football-data.org (falta «matches[].utcDate»)');
  }
  const out: Match[] = [];
  for (const raw of data['matches'] as unknown[]) {
    if (!isRecord(raw)) continue;
    const when = splitUtc(str(raw['utcDate']) ?? '');
    const homeTeam = isRecord(raw['homeTeam']) ? raw['homeTeam'] : null;
    const awayTeam = isRecord(raw['awayTeam']) ? raw['awayTeam'] : null;
    const home = str(homeTeam?.['name']);
    const away = str(awayTeam?.['name']);
    if (when === null || home === null || away === null) continue; // eliminatorias sin equipos definidos
    const stage = str(raw['stage']);
    const matchday = int(raw['matchday']);
    const round = [stage === null ? null : (STAGE_ES[stage] ?? stage), matchday === null ? null : `Jornada ${String(matchday)}`]
      .filter((p): p is string => p !== null)
      .join(' · ');
    const full = isRecord(raw['score']) && isRecord(raw['score']['fullTime']) ? raw['score']['fullTime'] : null;
    const h = int(full?.['home']);
    const a = int(full?.['away']);
    out.push(
      build(ctx, {
        round: round === '' ? 'Partido' : round,
        date: when.date,
        time: when.time,
        timeKind: 'utc',
        home,
        away,
        realScore: h !== null && a !== null ? { home: h, away: a } : null,
      }),
    );
  }
  if (out.length === 0) throw new DataError('parse', 'El archivo no contiene ningún partido con equipos definidos');
  return dedupe(sortMatches(out));
}

/** fixturedownload.com (`/feed/json/<competición>`): `DateUtc` en UTC. */
export function parseFixtureDownload(data: unknown, ctx: ParseContext): Match[] {
  if (!Array.isArray(data) || !(isRecord(data[0]) && 'HomeTeam' in data[0])) {
    throw new DataError('parse', 'El archivo no tiene el formato de fixturedownload.com (lista con «HomeTeam»)');
  }
  const out: Match[] = [];
  for (const raw of data as unknown[]) {
    if (!isRecord(raw)) continue;
    const when = splitUtc(str(raw['DateUtc']) ?? '');
    const home = str(raw['HomeTeam']);
    const away = str(raw['AwayTeam']);
    if (when === null || home === null || away === null) continue;
    const roundNumber = int(raw['RoundNumber']);
    const h = int(raw['HomeTeamScore']);
    const a = int(raw['AwayTeamScore']);
    out.push(
      build(ctx, {
        round: roundNumber === null ? 'Partido' : `Jornada ${String(roundNumber)}`,
        date: when.date,
        time: when.time,
        timeKind: 'utc',
        home,
        away,
        realScore: h !== null && a !== null ? { home: h, away: a } : null,
      }),
    );
  }
  if (out.length === 0) throw new DataError('parse', 'El archivo no contiene ningún partido con equipos definidos');
  return dedupe(sortMatches(out));
}

export type DetectedFormat = 'openfootball-json' | 'football-txt' | 'football-data-org' | 'fixturedownload';

export interface ImportResult {
  readonly format: DetectedFormat;
  readonly matches: Match[];
}

/** Detecta el formato de un archivo importado por el usuario y lo convierte a `Match[]`. */
export function parseImportedCalendar(text: string, ctx: ParseContext): ImportResult {
  const trimmed = text.trim();
  if (trimmed === '') throw new DataError('parse', 'El archivo está vacío');
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch (error) {
      throw new DataError('parse', 'El archivo no es un JSON válido', { cause: error });
    }
    if (Array.isArray(data)) return { format: 'fixturedownload', matches: parseFixtureDownload(data, ctx) };
    if (isRecord(data) && Array.isArray(data['matches'])) {
      const first: unknown = data['matches'][0];
      if (isRecord(first) && 'utcDate' in first) {
        return { format: 'football-data-org', matches: parseFootballDataOrg(data, ctx) };
      }
      return { format: 'openfootball-json', matches: parseOpenFootballJson(data, ctx) };
    }
    throw new DataError('parse', 'Formato JSON no reconocido (se admiten openfootball, football-data.org y fixturedownload.com)');
  }
  return { format: 'football-txt', matches: parseFootballTxt(trimmed, ctx) };
}
