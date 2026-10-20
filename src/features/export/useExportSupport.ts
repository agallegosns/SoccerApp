import { useEffect, useState } from 'react';

import type { ExportError } from './errors.ts';
import { checkExportSupport } from './exportVideo.ts';

export type Support = { readonly state: 'checking' } | { readonly state: 'ok' } | { readonly state: 'no'; readonly error: ExportError };

/** Comprueba una vez si este navegador puede codificar el vídeo del producto (H.264 a 1080×1920). */
export function useExportSupport(): Support {
  const [support, setSupport] = useState<Support>({ state: 'checking' });
  useEffect(() => {
    let alive = true;
    void checkExportSupport().then((check) => {
      if (alive) setSupport(check.supported || check.error === null ? { state: 'ok' } : { state: 'no', error: check.error });
    });
    return () => {
      alive = false;
    };
  }, []);
  return support;
}

/** Descarga un `Blob` con el nombre indicado (enlace temporal). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => { URL.revokeObjectURL(url); }, 30_000);
}
