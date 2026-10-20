import { useCallback, useEffect, useState } from 'react';

import type { MatchService } from '../../data/registry.ts';
import type { Match } from '../../data/types.ts';
import { DataError } from '../../data/types.ts';

export type MatchesState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly matches: readonly Match[]; readonly stale: boolean; readonly savedAt: number }
  | { readonly status: 'error'; readonly error: DataError };

type Settled = { readonly key: string } & (
  | { readonly status: 'ready'; readonly matches: readonly Match[]; readonly stale: boolean; readonly savedAt: number }
  | { readonly status: 'error'; readonly error: DataError }
);

function toDataError(error: unknown): DataError {
  return error instanceof DataError ? error : new DataError('network', 'Error inesperado al cargar los partidos', { cause: error });
}

/** Carga los partidos de una liga (con reintentos y caché en el servicio) y expone un reintento manual. Con `leagueId === ''` no hace nada (`idle`). */
export function useLeagueMatches(service: MatchService, leagueId: string, version = 0): MatchesState & { reload: () => void } {
  const [reloads, setReloads] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const key = `${leagueId}#${String(reloads)}#${String(version)}`;

  useEffect(() => {
    if (leagueId === '') return undefined;
    const controller = new AbortController();
    service
      .load(leagueId, { signal: controller.signal, force: reloads > 0 })
      .then((result) => {
        setSettled({ key, status: 'ready', matches: result.matches, stale: result.stale, savedAt: result.savedAt });
      })
      .catch((error: unknown) => {
        const dataError = toDataError(error);
        if (dataError.kind !== 'aborted') setSettled({ key, status: 'error', error: dataError });
      });
    return () => {
      controller.abort();
    };
  }, [service, leagueId, reloads, key]);

  const reload = useCallback(() => {
    setReloads((n) => n + 1);
  }, []);

  if (leagueId === '') return { status: 'idle', reload };
  if (settled?.key !== key) return { status: 'loading', reload };
  return settled.status === 'ready'
    ? { status: 'ready', matches: settled.matches, stale: settled.stale, savedAt: settled.savedAt, reload }
    : { status: 'error', error: settled.error, reload };
}
