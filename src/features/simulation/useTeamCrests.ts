import { useCallback, useEffect, useState } from 'react';

import { DataError } from '../../data/types.ts';
import { deleteCrest, fileToCrestDataUrl, loadStoredCrest, registerCrest, storeCrest, validateCrestFile } from './crestStore.ts';

export interface TeamCrests {
  /** Cambia cada vez que se carga, sube o quita un escudo: sirve para redibujar la vista previa y reiniciar exportaciones. */
  readonly version: number;
  readonly error: string | null;
  /** Equipo cuyo escudo se está procesando. */
  readonly busy: string | null;
  upload(teamName: string, file: File): Promise<void>;
  remove(teamName: string): void;
}

/** Carga los escudos guardados de los dos equipos y permite subir o quitar el de cada uno. */
export function useTeamCrests(home: string, away: string): TeamCrests {
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([loadStoredCrest(home), loadStoredCrest(away)])
      .then(() => {
        if (alive) setVersion((v) => v + 1);
      })
      .catch((cause: unknown) => {
        console.warn('No se pudieron cargar los escudos guardados', cause);
        if (alive) setError('No se pudieron cargar los escudos guardados en este navegador.');
      });
    return () => {
      alive = false;
    };
  }, [home, away]);

  const upload = useCallback(async (teamName: string, file: File): Promise<void> => {
    const problem = validateCrestFile(file);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setBusy(teamName);
    setError(null);
    try {
      const dataUrl = await fileToCrestDataUrl(file);
      storeCrest(teamName, dataUrl);
      const blob = await (await fetch(dataUrl)).blob();
      registerCrest(teamName, await createImageBitmap(blob));
      setVersion((v) => v + 1);
    } catch (cause) {
      setError(cause instanceof DataError || cause instanceof Error ? cause.message : 'No se pudo guardar el escudo.');
    } finally {
      setBusy(null);
    }
  }, []);

  const remove = useCallback((teamName: string): void => {
    deleteCrest(teamName);
    registerCrest(teamName, null);
    setError(null);
    setVersion((v) => v + 1);
  }, []);

  return { version, error, busy, upload, remove };
}
