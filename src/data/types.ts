/** Modelo de datos REALES de partidos. Nada de lo que hay aquí es ficticio. */

/**
 * Cómo interpretar `date`/`time` de un partido:
 * - `league-local`: hora local de la competición, sin zona declarada (openfootball). Se muestra tal cual.
 * - `utc`: instante en UTC (p. ej. football-data.org). Se convierte a la zona horaria del usuario.
 */
export type TimeKind = 'league-local' | 'utc';

export interface RealScore {
  readonly home: number;
  readonly away: number;
  /** Aclaración de cómo acabó (prórroga, penaltis…). */
  readonly note?: string;
}

export interface Match {
  /** Identificador estable y único dentro de la aplicación. */
  readonly id: string;
  readonly leagueId: string;
  readonly competition: string;
  readonly round: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** `HH:mm`, o `null` si la fuente no publica la hora. */
  readonly time: string | null;
  readonly timeKind: TimeKind;
  readonly home: string;
  readonly away: string;
  /** Resultado REAL si el partido ya se ha jugado y la fuente lo publica. */
  readonly realScore: RealScore | null;
}

export interface League {
  readonly id: string;
  readonly providerId: string;
  readonly name: string;
  readonly country: string;
  readonly season: string;
  /** Aviso opcional (p. ej. «temporada anterior»). */
  readonly note?: string;
  /** Explicación de la zona horaria de los horarios de esta liga. */
  readonly timeNote: string;
  /** `true` si aún no hay calendario: la competición espera a que el usuario importe un archivo. */
  readonly awaitingImport?: boolean;
}

export interface LoadOptions {
  readonly signal?: AbortSignal;
}

/** Contrato que cumple cualquier origen de partidos; la UI solo conoce esta interfaz. */
export interface MatchProvider {
  readonly id: string;
  readonly label: string;
  listLeagues(): readonly League[];
  loadMatches(leagueId: string, options?: LoadOptions): Promise<readonly Match[]>;
}

export type DataErrorKind = 'network' | 'http' | 'parse' | 'aborted' | 'not-found' | 'storage';

export class DataError extends Error {
  readonly kind: DataErrorKind;
  readonly status: number | undefined;

  constructor(kind: DataErrorKind, message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DataError';
    this.kind = kind;
    this.status = options?.status;
  }
}
