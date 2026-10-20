import { hashString } from './rng.ts';

/** Colores genéricos derivados del nombre del equipo (sin escudos ni equipaciones protegidos). */
export interface TeamStyle {
  readonly primary: string;
  readonly secondary: string;
  readonly keeper: string;
  readonly textOnPrimary: string;
  /** Abreviatura de 3 letras. */
  readonly abbr: string;
  /** Nombre corto para el marcador. */
  readonly short: string;
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number): number => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number): number => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number): string =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

export function relativeLuminance(hex: string): number {
  const v = Number.parseInt(hex.slice(1), 16);
  const ch = (c: number): number => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((v >> 16) & 255) + 0.7152 * ch((v >> 8) & 255) + 0.0722 * ch(v & 255);
}

const hueGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const STOP = new Set(['fc', 'cf', 'cd', 'afc', 'rcd', 'rc', 'ud', 'sd', 'sk', 'fk', 'ac', 'as', 'ss', 'ssc', 'sc', 'us', 'ca', 'vfb', 'vfl', 'sv', 'tsg', 'rb', 'bsc', 'og', '1.', 'de', 'del', 'la', 'el']);
const strip = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '');

export function shortName(name: string): string {
  const words = name.trim().split(/\s+/);
  const kept = words.filter((w) => !STOP.has(strip(w).toLowerCase().replace(/\.$/, '')));
  return (kept.length > 0 ? kept : words).join(' ');
}

export function abbreviation(name: string): string {
  const words = strip(shortName(name))
    .toUpperCase()
    .split(/[\s\-/.]+/)
    .filter((w) => w !== '');
  const first = words[0] ?? 'EQP';
  const last = words.at(-1) ?? first;
  const abbr = words.length >= 2 ? `${first.slice(0, 1)}${last.slice(0, 2)}` : first.slice(0, 3);
  return abbr.padEnd(3, 'X');
}

const KEEPER_HUES = [48, 24, 98, 188, 300];

export function teamStyles(homeName: string, awayName: string): { home: TeamStyle; away: TeamStyle } {
  const homeHue = hashString(homeName) % 360;
  let awayHue = hashString(awayName) % 360;
  if (hueGap(homeHue, awayHue) < 70) awayHue = (homeHue + 140 + (hashString(awayName) % 80)) % 360;
  const keeperHue = KEEPER_HUES.reduce((best, h) =>
    Math.min(hueGap(h, homeHue), hueGap(h, awayHue)) > Math.min(hueGap(best, homeHue), hueGap(best, awayHue)) ? h : best,
  );
  const keeper = hslToHex(keeperHue, 90, 55);
  const build = (name: string, hue: number): TeamStyle => {
    const primary = hslToHex(hue, 68, 46);
    return {
      primary,
      secondary: hslToHex((hue + 20) % 360, 70, 82),
      keeper,
      textOnPrimary: relativeLuminance(primary) > 0.35 ? '#0b1220' : '#ffffff',
      abbr: abbreviation(name),
      short: shortName(name),
    };
  };
  const home = build(homeName, homeHue);
  let away = build(awayName, awayHue);
  if (away.abbr === home.abbr) away = { ...away, abbr: `${away.abbr.slice(0, 2)}${away.short.replace(/\W/g, '').slice(-1).toUpperCase() || 'X'}` };
  return { home, away };
}
