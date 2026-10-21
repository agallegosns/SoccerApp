import { simulate, simulateArena, type Simulation } from '../../engine/index.ts';
import type { SimulationInput } from '../../engine/types.ts';
import type { BounceLevel } from './options.ts';
import type { VideoStyle } from './renderers.ts';

/**
 * Simulación según el estilo del vídeo. **Arena**: física libre (el marcador sale del juego; se ignora cualquier marcador fijado).
 * **Táctico**: guion de ocasiones, donde sí se puede fijar el marcador.
 */
export function simulateFor(style: VideoStyle, input: SimulationInput, bounce: BounceLevel): Simulation {
  return style === 'arena' ? simulateArena({ ...input, score: null }, bounce) : simulate(input);
}

/** ¿Este estilo permite fijar el marcador? (La Arena no: el resultado sale de la física.) */
export const allowsFixedScore = (style: VideoStyle): boolean => style === 'tactical';
