import { frameAt } from './animate.ts';
import { generateScript } from './script.ts';
import type { FrameState, MatchScript, SimulationInput } from './types.ts';

export interface Simulation {
  readonly input: SimulationInput;
  readonly script: MatchScript;
  /** Estado de la escena en el instante `t` (segundos de vídeo). */
  frame(t: number): FrameState;
}

export function simulate(input: SimulationInput): Simulation {
  const script = generateScript(input);
  return { input, script, frame: (t) => frameAt(script, t) };
}

export { MAX_GOALS_PER_TEAM } from './script.ts';
export type * from './types.ts';
