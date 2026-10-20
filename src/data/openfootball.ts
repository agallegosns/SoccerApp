import { fetchTextWithRetry, type FetchOptions } from './fetchWithRetry.ts';
import { parseFootballTxt, parseOpenFootballJson } from './parsers.ts';
import type { League, LoadOptions, Match, MatchProvider } from './types.ts';
import { DataError } from './types.ts';

const JSON_BASE = 'https://raw.githubusercontent.com/openfootball/football.json/master';
const CL_BASE = 'https://raw.githubusercontent.com/openfootball/europe-champions-league/master';

const LEAGUE_TIME_NOTE =
  'Horarios en hora local de la competición, tal como los publica openfootball (sin zona horaria declarada). No se convierten a tu hora.';

interface Source {
  readonly league: League;
  readonly url: string;
  readonly format: 'json' | 'txt';
}

const SEASON = '2026-27';

const SOURCES: readonly Source[] = [
  { id: 'es.1', name: 'LaLiga', country: 'España' },
  { id: 'en.1', name: 'Premier League', country: 'Inglaterra' },
  { id: 'de.1', name: 'Bundesliga', country: 'Alemania' },
  { id: 'it.1', name: 'Serie A', country: 'Italia' },
  { id: 'fr.1', name: 'Ligue 1', country: 'Francia' },
].map(({ id, name, country }) => ({
  league: {
    id: `openfootball:${id}:${SEASON}`,
    providerId: 'openfootball',
    name,
    country,
    season: SEASON,
    timeNote: LEAGUE_TIME_NOTE,
  },
  url: `${JSON_BASE}/${SEASON}/${id}.json`,
  format: 'json' as const,
}));

const CHAMPIONS_PREVIOUS: Source = {
  league: {
    id: 'openfootball:cl:2025-26',
    providerId: 'openfootball',
    name: 'Champions League',
    country: 'Europa',
    season: '2025-26',
    note: 'Temporada anterior (finalizada). La Champions League 2026-27 está en su propia pestaña.',
    timeNote:
      'Horarios tal como los publica openfootball en el archivo de la Champions League (sin zona horaria declarada). No se convierten a tu hora.',
  },
  url: `${CL_BASE}/2025-26/cl.txt`,
  format: 'txt',
};

const ALL_SOURCES: readonly Source[] = [...SOURCES, CHAMPIONS_PREVIOUS];

export class OpenFootballProvider implements MatchProvider {
  readonly id = 'openfootball';
  readonly label = 'openfootball (datos abiertos)';

  constructor(private readonly fetchOptions: Omit<FetchOptions, 'signal'> = {}) {}

  listLeagues(): readonly League[] {
    return ALL_SOURCES.map((s) => s.league);
  }

  async loadMatches(leagueId: string, options: LoadOptions = {}): Promise<readonly Match[]> {
    const source = ALL_SOURCES.find((s) => s.league.id === leagueId);
    if (source === undefined) throw new DataError('not-found', `Liga desconocida: ${leagueId}`);
    const text = await fetchTextWithRetry(source.url, { ...this.fetchOptions, signal: options.signal });
    const ctx = { leagueId, competition: `${source.league.name} ${source.league.season}` };
    if (source.format === 'txt') return parseFootballTxt(text, ctx);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new DataError('parse', 'La respuesta de openfootball no es un JSON válido', { cause: error });
    }
    return parseOpenFootballJson(json, ctx);
  }
}
