import { readJson, writeJson } from '../../data/cache.ts';
import type { BounceLevel } from './bounce.ts';

/** Personalización del vídeo (se guarda en el navegador y se aplica a la vista previa, a la exportación y a los lotes). */
export type ThemeId = 'noche' | 'neon' | 'cesped' | 'fuego';

export interface ThemePalette {
  readonly label: string;
  readonly bgTop: string;
  readonly bgMid: string;
  readonly halo: string;
  readonly haloOff: string;
  readonly floor: readonly [string, string, string];
  readonly ring: string;
  /** Color de la muestra en el selector. */
  readonly swatch: string;
}

export const THEMES: Readonly<Record<ThemeId, ThemePalette>> = {
  noche: { label: 'Noche', bgTop: '#070d1c', bgMid: '#0b1530', halo: 'rgba(96, 165, 250, 0.42)', haloOff: 'rgba(96, 165, 250, 0)', floor: ['#173a6b', '#0f2548', '#0a1730'], ring: '#f8fbff', swatch: '#2f6fd0' },
  neon: { label: 'Neón', bgTop: '#0a0014', bgMid: '#150028', halo: 'rgba(217, 70, 239, 0.42)', haloOff: 'rgba(217, 70, 239, 0)', floor: ['#4a0f73', '#2a0648', '#14031f'], ring: '#fbe3ff', swatch: '#c026d3' },
  cesped: { label: 'Césped', bgTop: '#04120b', bgMid: '#06200f', halo: 'rgba(74, 222, 128, 0.4)', haloOff: 'rgba(74, 222, 128, 0)', floor: ['#1d6b3a', '#14502b', '#0b341b'], ring: '#ecfdf5', swatch: '#22a559' },
  fuego: { label: 'Fuego', bgTop: '#140703', bgMid: '#240b05', halo: 'rgba(251, 146, 60, 0.42)', haloOff: 'rgba(251, 146, 60, 0)', floor: ['#7a3012', '#541f0b', '#2e1207'], ring: '#fff7ed', swatch: '#ea6a1a' },
};

export const THEME_IDS = Object.keys(THEMES) as readonly ThemeId[];

export interface VideoOptions {
  readonly theme: ThemeId;
  readonly bounce: BounceLevel;
  readonly showStats: boolean;
  readonly showTicker: boolean;
  readonly ballTrail: boolean;
  /** Texto gancho bajo la competición (p. ej. «¿Quién gana?»). */
  readonly hook: string;
  /** Marca de agua al pie (p. ej. «@tu_cuenta»). */
  readonly watermark: string;
  /** Texto del banner de gol. */
  readonly goalText: string;
}

export const MAX_HOOK = 40;
export const MAX_WATERMARK = 30;
export const MAX_GOAL_TEXT = 14;

export const DEFAULT_VIDEO_OPTIONS: VideoOptions = {
  theme: 'noche',
  bounce: 'normal',
  showStats: true,
  showTicker: true,
  ballTrail: true,
  hook: '',
  watermark: '',
  goalText: '¡GOL!',
};

const BOUNCES: readonly BounceLevel[] = ['off', 'low', 'normal', 'high'];
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, fallback: string, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : fallback);
const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** Valida lo que venga del almacenamiento: cualquier valor raro vuelve al predeterminado (nunca rompe el vídeo). */
export function sanitizeOptions(value: unknown): VideoOptions {
  if (!isRecord(value)) return DEFAULT_VIDEO_OPTIONS;
  const d = DEFAULT_VIDEO_OPTIONS;
  const theme = THEME_IDS.find((id) => id === value['theme']) ?? d.theme;
  const bounce = BOUNCES.find((b) => b === value['bounce']) ?? d.bounce;
  return {
    theme,
    bounce,
    showStats: flag(value['showStats'], d.showStats),
    showTicker: flag(value['showTicker'], d.showTicker),
    ballTrail: flag(value['ballTrail'], d.ballTrail),
    hook: text(value['hook'], d.hook, MAX_HOOK),
    watermark: text(value['watermark'], d.watermark, MAX_WATERMARK),
    goalText: text(value['goalText'], d.goalText, MAX_GOAL_TEXT) || d.goalText,
  };
}

const KEY = 'video-options';

export function loadVideoOptions(): VideoOptions {
  try {
    const raw = readJson(KEY, (v): v is Record<string, unknown> => isRecord(v));
    return raw === null ? DEFAULT_VIDEO_OPTIONS : sanitizeOptions(raw);
  } catch (error) {
    console.warn('No se pudieron leer los ajustes del vídeo', error);
    return DEFAULT_VIDEO_OPTIONS;
  }
}

export function saveVideoOptions(options: VideoOptions): void {
  try {
    writeJson(KEY, options);
  } catch (error) {
    console.warn('No se pudieron guardar los ajustes del vídeo', error);
  }
}

/** Texto del banner de gol: el escrito por el usuario o «¡GOL!» si lo dejó vacío. */
export function goalTextOf(options: VideoOptions): string {
  const t = options.goalText.trim();
  return t === '' ? DEFAULT_VIDEO_OPTIONS.goalText : t;
}
