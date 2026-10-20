import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { contrastRatio } from './contrast.ts';

const css = readFileSync(new URL('../ui/tokens.css', import.meta.url), 'utf8');

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  const value = match?.[1];
  if (value === undefined) {
    throw new Error(`Token no encontrado: --${name}`);
  }
  return value;
}

// Pares texto/fondo que usa la interfaz. Texto normal exige 4.5:1 (WCAG AA).
const pairs: readonly (readonly [string, string])[] = [
  ['color-text', 'color-bg'],
  ['color-text', 'color-surface'],
  ['color-text', 'color-surface-2'],
  ['color-text-muted', 'color-bg'],
  ['color-text-muted', 'color-surface'],
  ['color-text-muted', 'color-surface-2'],
  ['color-accent', 'color-bg'],
  ['color-accent', 'color-surface'],
  ['color-accent-contrast', 'color-accent'],
  ['color-accent', 'color-accent-soft'],
  ['color-warning', 'color-warning-soft'],
  ['color-danger', 'color-danger-soft'],
  ['color-danger', 'color-surface'],
];

describe('contraste WCAG AA de los tokens', () => {
  it.each(pairs)('%s sobre %s ≥ 4.5:1', (fg, bg) => {
    expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('el anillo de foco es visible (≥ 3:1) sobre fondo y superficies', () => {
    for (const bg of ['color-bg', 'color-surface', 'color-surface-2']) {
      expect(contrastRatio(token('color-focus'), token(bg))).toBeGreaterThanOrEqual(3);
    }
  });

  it('el borde de los controles interactivos es distinguible (≥ 3:1)', () => {
    for (const bg of ['color-bg', 'color-surface', 'color-surface-2']) {
      expect(contrastRatio(token('color-control-border'), token(bg))).toBeGreaterThanOrEqual(3);
    }
  });
});
