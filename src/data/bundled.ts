import { fetchBytesWithRetry, type FetchOptions } from './fetchWithRetry.ts';
import { parseImportedCalendar } from './parsers.ts';
import type { League, LoadOptions, Match, MatchProvider } from './types.ts';
import { DataError } from './types.ts';

interface BundledSource {
  readonly league: League;
  /** Ruta relativa a `BASE_URL` del archivo incluido con la aplicación. */
  readonly path: string;
  readonly roundPrefix: string;
}

const BUNDLED: readonly BundledSource[] = [
  {
    league: {
      id: 'bundled:champions-league:2026-27',
      providerId: 'bundled',
      name: 'Champions League',
      country: 'Europa',
      season: '2026-27',
      note: 'Calendario de la fase de liga (8 jornadas, 144 partidos) aportado por ti en Excel. Las eliminatorias se añadirán cuando se conozcan.',
      timeNote:
        'Horas tal como aparecen en tu Excel (que no declara zona horaria). No se convierten a tu hora.',
    },
    path: 'data/champions-league-2026-27.xlsx',
    roundPrefix: 'Fase de liga',
  },
];

/** Calendarios que viajan con la aplicación (archivos en `public/data`), p. ej. el Excel de la Champions 2026-27. */
export class BundledProvider implements MatchProvider {
  readonly id = 'bundled';
  readonly label = 'Incluidos en la aplicación';

  constructor(
    private readonly baseUrl: string = import.meta.env.BASE_URL,
    private readonly fetchOptions: Omit<FetchOptions, 'signal'> = {},
  ) {}

  listLeagues(): readonly League[] {
    return BUNDLED.map((b) => b.league);
  }

  async loadMatches(leagueId: string, options: LoadOptions = {}): Promise<readonly Match[]> {
    const source = BUNDLED.find((b) => b.league.id === leagueId);
    if (source === undefined) throw new DataError('not-found', `Calendario incluido desconocido: ${leagueId}`);
    const bytes = await fetchBytesWithRetry(`${this.baseUrl}${source.path}`, { ...this.fetchOptions, signal: options.signal });
    return parseImportedCalendar(bytes, {
      leagueId,
      competition: `${source.league.name} ${source.league.season}`,
      roundPrefix: source.roundPrefix,
    }).matches;
  }
}
