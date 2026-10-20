import { slug } from '../../data/dates.ts';

export interface FileNameParts {
  /** «LaLiga 2026-27». */
  readonly competition: string;
  readonly home: string;
  readonly away: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly seed: number;
  /** Extensión sin punto (por defecto `mp4`). */
  readonly extension?: string;
}

/** `liga_local_vs_visitante_fecha_semilla.mp4`, siempre en minúsculas, sin acentos y seguro para cualquier sistema de archivos. */
export function exportFileName(parts: FileNameParts): string {
  const base = [slug(parts.competition), `${slug(parts.home)}_vs_${slug(parts.away)}`, parts.date, String(parts.seed)].join('_');
  return `${base}.${parts.extension ?? 'mp4'}`;
}

/** `liga_local_vs_visitante_fecha_N-videos.zip` para el ZIP de un lote. */
export function zipFileName(parts: Omit<FileNameParts, 'seed' | 'extension'>, count: number): string {
  const base = [slug(parts.competition), `${slug(parts.home)}_vs_${slug(parts.away)}`, parts.date, `${String(count)}-videos`].join('_');
  return `${base}.zip`;
}
