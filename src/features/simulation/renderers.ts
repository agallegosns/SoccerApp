import type { Simulation } from '../../engine/index.ts';
import { drawFrame, type Ctx2D, type RenderMeta } from './render.ts';
import { drawArenaFrame } from './renderArena.ts';

/** Estilos de vídeo: la misma simulación se puede dibujar de dos maneras. */
export type VideoStyle = 'arena' | 'tactical';

export const VIDEO_STYLES: readonly { readonly id: VideoStyle; readonly label: string; readonly hint: string }[] = [
  { id: 'arena', label: 'Arena', hint: 'Círculo con porterías giratorias, un escudo por equipo y el balón (formato viral).' },
  { id: 'tactical', label: 'Táctico', hint: 'Campo vertical con los 22 jugadores.' },
];

export const DEFAULT_STYLE: VideoStyle = 'arena';

/** Dibuja un fotograma en el estilo elegido. Misma función para la vista previa y para la exportación. */
export function drawVideoFrame(ctx: Ctx2D, sim: Simulation, t: number, meta: RenderMeta, style: VideoStyle): void {
  if (style === 'arena') drawArenaFrame(ctx, sim, t, meta);
  else drawFrame(ctx, sim, t, meta);
}
