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

/** Separación mínima (s) entre dos golpes de balón o dos choques con la pared; con menos suenan como una ametralladora. */
export const MIN_GAP: Readonly<Record<'kick' | 'wall', number>> = { kick: 0.14, wall: 0.12 };
/** Los golpes muy suaves (casi roces) no suenan. */
export const MIN_POWER = 0.25;

/** Quita los golpes/choques muy flojos o pegados a otro más fuerte (se queda el más fuerte de cada racha). */
export function thin(cues: readonly Cue[]): Cue[] {
  const out: Cue[] = cues.filter((c) => c.kind !== 'kick' && c.kind !== 'wall');
  for (const kind of ['kick', 'wall'] as const) {
    const kept: Extract<Cue, { kind: 'kick' | 'wall' }>[] = [];
    for (const c of cues) {
      if (c.kind !== kind || c.power < MIN_POWER) continue;
      const last = kept[kept.length - 1];
      if (last !== undefined && c.t - last.t < MIN_GAP[kind]) {
        if (c.power > last.power) kept[kept.length - 1] = c;
      } else {
        kept.push(c);
      }
    }
    out.push(...kept);
  }
  return out;
}

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
  return thin(cues).filter((c) => Number.isFinite(c.t) && c.t >= 0 && c.t < sim.script.duration).sort((a, b) => a.t - b.t);
}
