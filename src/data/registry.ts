import { BundledProvider } from './bundled.ts';
import { MatchCache } from './cache.ts';
import { ImportedProvider } from './imported.ts';
import { OpenFootballProvider } from './openfootball.ts';
import type { League, LoadOptions, Match, MatchProvider } from './types.ts';
import { DataError } from './types.ts';

export interface LoadedMatches {
  readonly matches: readonly Match[];
  /** `true` si la red falló y se muestra la última copia guardada. */
  readonly stale: boolean;
  /** Momento (ms) en que se obtuvo la copia mostrada. */
  readonly savedAt: number;
}

const FRESH_MS = 10 * 60 * 1000;
const PRIORITY: readonly RegExp[] = [/^LaLiga/, /^Champions League/, /^Europa League/, /^Conference League/];

/** Reúne los proveedores y añade caché (memoria + localStorage) con degradación a datos antiguos. */
export class MatchService {
  constructor(
    private readonly providers: readonly MatchProvider[],
    private readonly cache: MatchCache,
  ) {}

  /** Competiciones en orden de interés: LaLiga, Champions, Europa League, Conference League y el resto. */
  listLeagues(): League[] {
    const all = this.providers.flatMap((p) => [...p.listLeagues()]);
    const rank = (l: League): number => {
      const i = PRIORITY.findIndex((p) => p.test(`${l.name} ${l.season}`) && !(l.season === '2025-26'));
      return i < 0 ? PRIORITY.length : i;
    };
    return all
      .map((league, index) => ({ league, index }))
      .sort((a, b) => rank(a.league) - rank(b.league) || a.index - b.index)
      .map((x) => x.league);
  }

  private providerFor(leagueId: string): MatchProvider {
    const provider = this.providers.find((p) => p.listLeagues().some((l) => l.id === leagueId));
    if (provider === undefined) throw new DataError('not-found', `Liga desconocida: ${leagueId}`);
    return provider;
  }

  async load(leagueId: string, options: LoadOptions & { force?: boolean } = {}): Promise<LoadedMatches> {
    const provider = this.providerFor(leagueId);
    if (provider.id === 'imported') {
      if (this.providerFor(leagueId).listLeagues().find((l) => l.id === leagueId)?.awaitingImport === true) {
        throw new DataError('not-found', 'Esta competición aún no tiene calendario importado');
      }
      const matches = await provider.loadMatches(leagueId, options);
      return { matches, stale: false, savedAt: Date.now() };
    }
    if (options.force !== true) {
      const fresh = this.cache.getFresh(leagueId, FRESH_MS);
      if (fresh !== null) return { matches: fresh.matches, stale: false, savedAt: fresh.savedAt };
    }
    try {
      const matches = await provider.loadMatches(leagueId, options);
      this.cache.set(leagueId, matches);
      return { matches, stale: false, savedAt: Date.now() };
    } catch (error) {
      if (error instanceof DataError && error.kind === 'aborted') throw error;
      const stale = this.cache.getStale(leagueId);
      if (stale !== null) return { matches: stale.matches, stale: true, savedAt: stale.savedAt };
      throw error;
    }
  }
}

export interface AppServices {
  readonly service: MatchService;
  readonly imported: ImportedProvider;
}

export function createServices(): AppServices {
  const imported = new ImportedProvider();
  const service = new MatchService([new OpenFootballProvider(), new BundledProvider(), imported], new MatchCache());
  return { service, imported };
}
