import { describe, expect, it } from 'vitest';

import { DEFAULT_VIDEO_OPTIONS, MAX_GOAL_TEXT, MAX_HOOK, goalTextOf, sanitizeOptions } from './options.ts';

describe('opciones del vídeo', () => {
  it('cualquier valor raro vuelve a los predeterminados', () => {
    for (const bad of [null, undefined, 7, 'x', [], { theme: 'rosa', bounce: 'locos', showStats: 'sí', hook: 5 }]) {
      expect(sanitizeOptions(bad)).toEqual(DEFAULT_VIDEO_OPTIONS);
    }
  });

  it('acepta valores válidos, recorta textos y normaliza espacios', () => {
    const o = sanitizeOptions({ theme: 'neon', bounce: 'high', showStats: false, ballTrail: false, hook: `  ${'a '.repeat(60)}`, watermark: '  @yo   mismo ', goalText: 'GOLAZO!!!!!!!!!!!!!!!!!!' });
    expect(o.theme).toBe('neon');
    expect(o.bounce).toBe('high');
    expect(o.showStats).toBe(false);
    expect(o.ballTrail).toBe(false);
    expect(o.hook.length).toBeLessThanOrEqual(MAX_HOOK);
    expect(o.watermark).toBe('@yo mismo');
    expect(o.goalText.length).toBeLessThanOrEqual(MAX_GOAL_TEXT);
  });

  it('el texto del gol vacío vuelve a «¡GOL!»', () => {
    expect(sanitizeOptions({ goalText: '   ' }).goalText).toBe(DEFAULT_VIDEO_OPTIONS.goalText);
    expect(goalTextOf({ ...DEFAULT_VIDEO_OPTIONS, goalText: '  ' })).toBe('¡GOL!');
    expect(goalTextOf({ ...DEFAULT_VIDEO_OPTIONS, goalText: ' ¡GOLAZO! ' })).toBe('¡GOLAZO!');
  });
});
