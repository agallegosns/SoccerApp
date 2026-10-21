import { formatDateEs, kickoffOf } from '../../data/dates.ts';
import type { Match } from '../../data/types.ts';
import type { VideoOptions } from './options.ts';
import type { RenderMeta } from './render.ts';

/** Textos de cabecera del vídeo («LaLiga 2026-27 · Jornada 8», fecha y hora) para un partido y unas opciones. */
export function metaFor(match: Match, options: VideoOptions): RenderMeta {
  const kickoff = kickoffOf(match);
  return {
    competition: `${match.competition} · ${match.round}`,
    when: `${formatDateEs(kickoff.date)} · ${kickoff.time ?? 'hora por confirmar'}`,
    options,
  };
}
