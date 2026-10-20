export type ExportErrorKind = 'unsupported-browser' | 'codec-unsupported' | 'out-of-memory' | 'cancelled' | 'encode-failed';

export const RECOMMENDED_BROWSERS = 'Chrome, Edge o Safari recientes';

/** Error de exportación con un mensaje pensado para mostrarse tal cual al usuario. */
export class ExportError extends Error {
  readonly kind: ExportErrorKind;

  constructor(kind: ExportErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ExportError';
    this.kind = kind;
  }
}

export function unsupportedBrowser(): ExportError {
  return new ExportError(
    'unsupported-browser',
    `Este navegador no admite la codificación de vídeo (WebCodecs). Usa ${RECOMMENDED_BROWSERS}.`,
  );
}

export function codecUnsupported(codecLabel: string, width: number, height: number): ExportError {
  return new ExportError(
    'codec-unsupported',
    `Este navegador no puede codificar ${codecLabel} a ${String(width)}×${String(height)}. Usa ${RECOMMENDED_BROWSERS}.`,
  );
}

const MEMORY_HINTS = /out of memory|allocation|memory|quota/i;

/** Convierte cualquier fallo inesperado del codificador/muxer en un `ExportError` comprensible. */
export function classifyExportError(error: unknown): ExportError {
  if (error instanceof ExportError) return error;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'AbortError') return new ExportError('cancelled', 'Exportación cancelada.', { cause: error });
  if (name === 'QuotaExceededError' || name === 'RangeError' || MEMORY_HINTS.test(message)) {
    return new ExportError(
      'out-of-memory',
      'No hay memoria suficiente para terminar el vídeo. Cierra otras pestañas o aplicaciones e inténtalo de nuevo.',
      { cause: error },
    );
  }
  return new ExportError('encode-failed', `No se pudo codificar el vídeo: ${message}`, { cause: error });
}
