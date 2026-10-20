/**
 * Colores del vídeo (Canvas). Son datos de render, no de la interfaz web: la UI usa sólo tokens.css.
 * Los colores de los equipos vienen del motor (derivados del nombre).
 */
export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const VIDEO_FPS = 30;

export const CANVAS_THEME = {
  bgTop: '#0b1220',
  bgBottom: '#111a2e',
  panel: 'rgba(18, 27, 48, 0.92)',
  text: '#eaf0fb',
  muted: '#a3b1cf',
  amber: '#fbbf24',
  amberText: '#241a02',
  grassDark: '#1f7a46',
  grassLight: '#23854d',
  line: 'rgba(255, 255, 255, 0.88)',
  net: 'rgba(255, 255, 255, 0.35)',
  shadow: 'rgba(0, 0, 0, 0.28)',
  ball: '#ffffff',
  ballSpot: '#1b2233',
  highlight: '#fde047',
  passLine: 'rgba(255, 255, 255, 0.4)',
  overlay: 'rgba(7, 12, 24, 0.9)',
} as const;

export const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Texto que debe verse siempre en el vídeo. */
export const FICTIONAL_LABEL = 'SIMULACIÓN FICTICIA';
export const FICTIONAL_FOOTER = 'Simulación ficticia · Resultado inventado, no es una predicción';

/** Zona del vídeo reservada al campo (px). */
export const PITCH_RECT = { y: 530, height: 1120 } as const;
