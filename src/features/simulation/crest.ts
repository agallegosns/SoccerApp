import { hashString } from '../../engine/rng.ts';
import type { ResolvedTeam } from '../../engine/index.ts';
import { FONT_STACK } from './theme.ts';
import type { Ctx2D } from './render.ts';

/** Patrones de escudo genéricos (no reproducen ningún escudo real): se elige uno según el nombre del equipo. */
export const CREST_PATTERNS = ['stripes', 'hoops', 'halves', 'sash', 'chevron', 'plain'] as const;
export type CrestPattern = (typeof CREST_PATTERNS)[number];

export function crestPattern(teamName: string): CrestPattern {
  return CREST_PATTERNS[hashString(teamName) % CREST_PATTERNS.length] ?? 'plain';
}

function drawPattern(ctx: Ctx2D, pattern: CrestPattern, secondary: string, r: number): void {
  ctx.fillStyle = secondary;
  switch (pattern) {
    case 'stripes':
      for (let i = -2; i <= 2; i += 2) ctx.fillRect((i - 0.5) * (r / 2.5), -r, r / 2.5, 2 * r);
      break;
    case 'hoops':
      for (let i = -2; i <= 2; i += 2) ctx.fillRect(-r, (i - 0.5) * (r / 2.5), 2 * r, r / 2.5);
      break;
    case 'halves':
      ctx.fillRect(0, -r, r, 2 * r);
      break;
    case 'sash':
      ctx.save();
      ctx.rotate(-Math.PI / 4);
      ctx.fillRect(-r * 1.5, -r * 0.3, r * 3, r * 0.6);
      ctx.restore();
      break;
    case 'chevron':
      ctx.beginPath();
      ctx.moveTo(-r, -r * 0.1);
      ctx.lineTo(0, r * 0.55);
      ctx.lineTo(r, -r * 0.1);
      ctx.lineTo(r, r * 0.3);
      ctx.lineTo(0, r * 0.95);
      ctx.lineTo(-r, r * 0.3);
      ctx.closePath();
      ctx.fill();
      break;
    case 'plain':
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
      ctx.lineWidth = r * 0.16;
      ctx.strokeStyle = secondary;
      ctx.stroke();
      break;
  }
}

/** Escudo circular genérico del equipo: colores del equipo, patrón propio y abreviatura. */
export function drawCrest(ctx: Ctx2D, team: ResolvedTeam, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  // Sombra de contacto.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.12, r * 1.02, r * 1.02, 0, 0, Math.PI * 2);
  ctx.fill();
  // Cuerpo.
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = team.style.primary;
  ctx.fillRect(-r, -r, 2 * r, 2 * r);
  drawPattern(ctx, crestPattern(team.name), team.style.secondary, r);
  const shine = ctx.createLinearGradient(0, -r, 0, r);
  shine.addColorStop(0, 'rgba(255,255,255,0.28)');
  shine.addColorStop(0.5, 'rgba(255,255,255,0)');
  shine.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = shine;
  ctx.fillRect(-r, -r, 2 * r, 2 * r);
  ctx.restore();
  // Aro.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.arc(0, 0, r - r * 0.04, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(3, r * 0.1);
  ctx.strokeStyle = team.style.secondary;
  ctx.stroke();
  // Abreviatura sobre una placa oscura para que se lea con cualquier patrón.
  const size = Math.round(r * 0.62);
  ctx.font = `800 ${String(size)}px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(team.style.abbr).width + r * 0.3;
  ctx.fillStyle = 'rgba(8, 12, 24, 0.62)';
  ctx.beginPath();
  ctx.roundRect(-w / 2, -size * 0.62, w, size * 1.24, size * 0.3);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(team.style.abbr, 0, size * 0.04);
  ctx.restore();
}
