import { readJson, writeJson, type KeyValueStore, browserStore } from './cache.ts';
import { slug } from './dates.ts';
import { isRecord, parseImportedCalendar, type DetectedFormat } from './parsers.ts';
import type { League, Match, MatchProvider } from './types.ts';
import { DataError } from './types.ts';

const STORE_KEY = 'imported-calendars';

interface StoredCalendar {
  readonly league: League;
  readonly format: DetectedFormat;
  readonly matches: readonly Match[];
}

function isStoredList(value: unknown): value is StoredCalendar[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) && isRecord(item['league']) && typeof item['league']['id'] === 'string' && Array.isArray(item['matches']),
    )
  );
}

export interface ImportRequest {
  readonly name: string;
  readonly season: string;
  /** Texto (JSON/TXT) o bytes de un .xlsx. */
  readonly content: string | Uint8Array;
}

/** Competiciones que la app deja «preparadas»: aparecen en la lista y se rellenan al importar su archivo. */
export const AWAITED_COMPETITIONS: readonly { readonly name: string; readonly season: string; readonly country: string }[] = [
  { name: 'Europa League', season: '2026-27', country: 'Europa' },
  { name: 'Conference League', season: '2026-27', country: 'Europa' },
];

export function importedLeagueId(name: string, season: string): string {
  return `imported:${slug(name)}:${slug(season)}`;
}

const IMPORTED_NOTE = 'Calendario importado desde un archivo tuyo; se guarda solo en este navegador.';
const IMPORTED_TIME_NOTE =
  'Si el archivo viene de football-data.org o fixturedownload.com las horas están en UTC y se muestran en tu zona horaria; si viene de un Excel, de openfootball o de un .txt son horas locales sin zona declarada y se muestran tal cual.';

/** Calendarios que el usuario importa desde un archivo; se guardan sólo en su navegador. */
export class ImportedProvider implements MatchProvider {
  readonly id = 'imported';
  readonly label = 'Importados por ti';
  private calendars: StoredCalendar[];

  constructor(private readonly store: KeyValueStore | null = browserStore()) {
    this.calendars = readJson(STORE_KEY, isStoredList, store) ?? [];
  }

  listLeagues(): readonly League[] {
    const awaiting = AWAITED_COMPETITIONS.map(
      (c): League => ({
        id: importedLeagueId(c.name, c.season),
        providerId: this.id,
        name: c.name,
        country: c.country,
        season: c.season,
        awaitingImport: true,
        note: 'Aún no hay calendario público y gratuito de esta competición: importa tu archivo (Excel, JSON o TXT) para verla aquí.',
        timeNote: IMPORTED_TIME_NOTE,
      }),
    ).filter((slot) => !this.calendars.some((c) => c.league.id === slot.id));
    return [...this.calendars.map((c) => c.league), ...awaiting];
  }

  loadMatches(leagueId: string): Promise<readonly Match[]> {
    const found = this.calendars.find((c) => c.league.id === leagueId);
    return found === undefined
      ? Promise.reject(new DataError('not-found', `Calendario importado no encontrado: ${leagueId}`))
      : Promise.resolve(found.matches);
  }

  /** Convierte y guarda un archivo. Lanza `DataError` si el formato no es válido o no cabe en el almacenamiento. */
  importCalendar(request: ImportRequest): League {
    const name = request.name.trim();
    if (name === '') throw new DataError('parse', 'Indica un nombre para el calendario');
    const id = importedLeagueId(name, request.season);
    const league: League = {
      id,
      providerId: this.id,
      name,
      country: 'Importado',
      season: request.season.trim(),
      note: IMPORTED_NOTE,
      timeNote: IMPORTED_TIME_NOTE,
    };
    const result = parseImportedCalendar(request.content, { leagueId: id, competition: `${name} ${league.season}` });
    const next = [...this.calendars.filter((c) => c.league.id !== id), { league, format: result.format, matches: result.matches }];
    writeJson(STORE_KEY, next, this.store); // lanza DataError('storage') si no cabe; no tocamos el estado antes
    this.calendars = next;
    return league;
  }

  removeCalendar(leagueId: string): void {
    const next = this.calendars.filter((c) => c.league.id !== leagueId);
    writeJson(STORE_KEY, next, this.store);
    this.calendars = next;
  }
}
