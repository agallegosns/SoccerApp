export type Role = 'GK' | 'CB' | 'LB' | 'RB' | 'LWB' | 'RWB' | 'DM' | 'CM' | 'AM' | 'LM' | 'RM' | 'LW' | 'RW' | 'ST';
export type FormationId = '4-3-3' | '4-4-2' | '4-2-3-1' | '3-5-2' | '3-4-3';

export interface Slot {
  readonly role: Role;
  /** Lateral en el marco del equipo: 0 = su izquierda, 1 = su derecha. */
  readonly l: number;
  /** Profundidad: 0 = su portería, 1 = portería rival. */
  readonly d: number;
}

const s = (role: Role, l: number, d: number): Slot => ({ role, l, d });

export const FORMATIONS: Readonly<Record<FormationId, readonly Slot[]>> = {
  '4-3-3': [
    s('GK', 0.5, 0), s('LB', 0.12, 0.25), s('CB', 0.36, 0.2), s('CB', 0.64, 0.2), s('RB', 0.88, 0.25),
    s('CM', 0.28, 0.48), s('DM', 0.5, 0.4), s('CM', 0.72, 0.48),
    s('LW', 0.13, 0.78), s('ST', 0.5, 0.88), s('RW', 0.87, 0.78),
  ],
  '4-4-2': [
    s('GK', 0.5, 0), s('LB', 0.12, 0.25), s('CB', 0.36, 0.2), s('CB', 0.64, 0.2), s('RB', 0.88, 0.25),
    s('LM', 0.1, 0.55), s('CM', 0.38, 0.48), s('CM', 0.62, 0.48), s('RM', 0.9, 0.55),
    s('ST', 0.38, 0.85), s('ST', 0.62, 0.85),
  ],
  '4-2-3-1': [
    s('GK', 0.5, 0), s('LB', 0.12, 0.25), s('CB', 0.36, 0.2), s('CB', 0.64, 0.2), s('RB', 0.88, 0.25),
    s('DM', 0.38, 0.4), s('DM', 0.62, 0.4),
    s('LW', 0.14, 0.68), s('AM', 0.5, 0.66), s('RW', 0.86, 0.68),
    s('ST', 0.5, 0.88),
  ],
  '3-5-2': [
    s('GK', 0.5, 0), s('CB', 0.25, 0.2), s('CB', 0.5, 0.17), s('CB', 0.75, 0.2),
    s('LWB', 0.07, 0.5), s('CM', 0.32, 0.45), s('DM', 0.5, 0.38), s('CM', 0.68, 0.45), s('RWB', 0.93, 0.5),
    s('ST', 0.38, 0.85), s('ST', 0.62, 0.85),
  ],
  '3-4-3': [
    s('GK', 0.5, 0), s('CB', 0.25, 0.2), s('CB', 0.5, 0.17), s('CB', 0.75, 0.2),
    s('LM', 0.1, 0.5), s('CM', 0.38, 0.45), s('CM', 0.62, 0.45), s('RM', 0.9, 0.5),
    s('LW', 0.15, 0.8), s('ST', 0.5, 0.88), s('RW', 0.85, 0.8),
  ],
};

export const FORMATION_IDS: readonly FormationId[] = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '3-4-3'];

export function slotsOf(id: FormationId): readonly Slot[] {
  return FORMATIONS[id];
}
