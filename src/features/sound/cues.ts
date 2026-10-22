import type { Simulation } from '../../engine/index.ts';
import { touchEvents, wallEvents } from '../simulation/arena.ts';
import type { VideoStyle } from '../simulation/renderers.ts';

/** Un sonido puntual de la pista: cuándo suena (s de vídeo) y de qué tipo. `power` 0–1 modula el volumen. */
export type Cue =
  | { readonly t: number; readonly kind: 'kick'; readonly power: number }
  | { readonly t: number; readonly kind: 'wall'; readonly power: number }
  | { readonly t: number; readonly kind: 'whistle'; readonly blasts: 1 | 2 | 3 }
  | { readonly t: number; readonly kind: 'goal' }
  | { readonly t: number; readonly kind: 'save' }
  | { readonly t: number; readonly kind: 'post' }
  | { readonly t: number; readonly kind: 'miss' }
  | { readonly t: number; readonly kind: 'whoosh' };

/** Deriva, de forma pura, los sonidos de una simulación a partir de sus sucesos reales (nada se inventa aparte). */
export function soundCues(sim: Simulation, style: VideoStyle): Cue[] {
  const cues: Cue[] = [];
  const { events, ball } = sim.script;
  for (const e of events) {
    switch (e.type) {
      case 'kickoff': cues.push({ t: e.t, kind: 'whistle', blasts: 1 }); break;
      case 'halftime': cues.push({ t: e.t, kind: 'whistle', blasts: 2 }); break;
      case 'fulltime': cues.push({ t: e.t, kind: 'whistle', blasts: 3 }); break;
      case 'foul': cues.push({ t: e.t, kind: 'whistle', blasts: 1 }); break;
      case 'goal': cues.push({ t: e.t, kind: 'goal' }); break;
      case 'save': cues.push({ t: e.t, kind: 'save' }); break;
      case 'post': cues.push({ t: e.t, kind: 'post' }); break;
      case 'miss': cues.push({ t: e.t, kind: 'miss' }); break;
      case 'shot': cues.push({ t: e.t, kind: 'whoosh' }); break;
      default: break;
    }
  }
  if (style === 'arena' && sim.arena !== undefined) {
    for (const k of touchEvents(sim)) cues.push({ t: k.t, kind: 'kick', power: k.power });
    for (const w of wallEvents(sim)) cues.push({ t: w.t, kind: 'wall', power: w.power });
  } else {
    for (const s of ball) {
      if (s.kind === 'pass' || s.kind === 'cross') cues.push({ t: s.t0, kind: 'kick', power: s.kind === 'cross' ? 0.7 : 0.45 });
      else if (s.kind === 'shot') cues.push({ t: s.t0, kind: 'kick', power: 1 });
    }
  }
  return cues.filter((c) => Number.isFinite(c.t) && c.t >= 0 && c.t < sim.script.duration).sort((a, b) => a.t - b.t);
}
