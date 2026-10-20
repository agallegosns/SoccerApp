import { phaseAt, statsAt } from '../../engine/animate.ts';
import { PITCH_L, PITCH_W, clamp, smoothstep } from '../../engine/geometry.ts';
import type { FrameState, PlayerFrame, ResolvedTeam, Side, Simulation } from '../../engine/index.ts';
import { drawCrest } from './crest.ts';
import { CANVAS_THEME as C, FONT_STACK, PITCH_RECT, VIDEO_HEIGHT, VIDEO_WIDTH } from './theme.ts';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type PitchCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface RenderMeta {
  /** «LaLiga 2026-27 · Jornada 8». */
  readonly competition: string;
  /** «sábado, 24 de octubre de 2026 · 12:30». */
  readonly when: string;
}

const SCALE = PITCH_RECT.height / PITCH_L; // px por metro
const PITCH_PX_W = PITCH_W * SCALE;
const PITCH_X0 = (VIDEO_WIDTH - PITCH_PX_W) / 2;
const PITCH_Y0 = PITCH_RECT.y;

const px = (x: number): number => PITCH_X0 + x * SCALE;
const py = (y: number): number => PITCH_Y0 + y * SCALE;

export const font = (size: number, weight = 700): string => `${String(weight)} ${String(size)}px ${FONT_STACK}`;

export function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Reduce el tamaño de letra hasta que el texto cabe en `maxWidth`. */
export function fitFont(ctx: Ctx2D, text: string, maxWidth: number, size: number, weight = 700, min = 18): number {
  let s = size;
  ctx.font = font(s, weight);
  while (s > min && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = font(s, weight);
  }
  return s;
}

let pitchLayer: PitchCanvas | null = null;

function makeCanvas(w: number, h: number): PitchCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function drawPitchLines(ctx: Ctx2D): void {
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 3;
  const X = (m: number): number => px(m);
  const Y = (m: number): number => py(m);
  ctx.strokeRect(X(0), Y(0), PITCH_PX_W, PITCH_RECT.height);
  ctx.beginPath();
  ctx.moveTo(X(0), Y(PITCH_L / 2));
  ctx.lineTo(X(PITCH_W), Y(PITCH_L / 2));
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(X(PITCH_W / 2), Y(PITCH_L / 2), 9.15 * SCALE, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = C.line;
  ctx.beginPath();
  ctx.arc(X(PITCH_W / 2), Y(PITCH_L / 2), 5, 0, Math.PI * 2);
  ctx.fill();
  for (const top of [true, false]) {
    const goalY = top ? 0 : PITCH_L;
    const dir = top ? 1 : -1;
    const boxW = 40.32;
    const boxD = 16.5;
    const sixW = 18.32;
    const sixD = 5.5;
    ctx.strokeRect(X((PITCH_W - boxW) / 2), top ? Y(0) : Y(PITCH_L - boxD), boxW * SCALE, boxD * SCALE);
    ctx.strokeRect(X((PITCH_W - sixW) / 2), top ? Y(0) : Y(PITCH_L - sixD), sixW * SCALE, sixD * SCALE);
    ctx.beginPath();
    ctx.arc(X(PITCH_W / 2), Y(goalY + dir * 11), 5, 0, Math.PI * 2);
    ctx.fill();
    // Arco del área: la parte del círculo del punto de penalti que queda fuera del área grande.
    const a = Math.asin((boxD - 11) / 9.15);
    ctx.beginPath();
    if (top) ctx.arc(X(PITCH_W / 2), Y(goalY + dir * 11), 9.15 * SCALE, a, Math.PI - a);
    else ctx.arc(X(PITCH_W / 2), Y(goalY + dir * 11), 9.15 * SCALE, Math.PI + a, 2 * Math.PI - a);
    ctx.stroke();
    // Portería con red.
    const gw = 7.32 * SCALE;
    const gd = 2.4 * SCALE;
    const gx = X((PITCH_W - 7.32) / 2);
    const gy = top ? Y(0) - gd : Y(PITCH_L);
    ctx.fillStyle = C.net;
    ctx.fillRect(gx, gy, gw, gd);
    ctx.strokeStyle = C.line;
    ctx.strokeRect(gx, gy, gw, gd);
  }
  for (const [cx, cy, start] of [[0, 0, 0], [PITCH_W, 0, Math.PI / 2], [PITCH_W, PITCH_L, Math.PI], [0, PITCH_L, Math.PI * 1.5]] as const) {
    ctx.beginPath();
    ctx.arc(X(cx), Y(cy), 1 * SCALE, start, start + Math.PI / 2);
    ctx.stroke();
  }
}

function pitchCanvas(): PitchCanvas {
  if (pitchLayer !== null) return pitchLayer;
  const canvas = makeCanvas(VIDEO_WIDTH, VIDEO_HEIGHT);
  const ctx: Ctx2D | null = canvas.getContext('2d');
  if (ctx === null) throw new Error('No se pudo crear el lienzo del campo');
  const stripes = 14;
  const stripeH = PITCH_RECT.height / stripes;
  for (let i = 0; i < stripes; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? C.grassDark : C.grassLight;
    ctx.fillRect(PITCH_X0, PITCH_Y0 + i * stripeH, PITCH_PX_W, stripeH + 0.5);
  }
  drawPitchLines(ctx);
  pitchLayer = canvas;
  return canvas;
}

function drawBackground(ctx: Ctx2D): void {
  const g = ctx.createLinearGradient(0, 0, 0, VIDEO_HEIGHT);
  g.addColorStop(0, C.bgTop);
  g.addColorStop(1, C.bgBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
}

function drawBadge(ctx: Ctx2D, team: ResolvedTeam, cx: number, cy: number, r: number): void {
  drawCrest(ctx, team, cx, cy, r);
}

/** Píldora de la cabecera con la competición, la fase y la jornada («Champions League 2026-27 · Fase de liga · Jornada 3»). */
export function drawCompetitionPill(ctx: Ctx2D, text: string): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = fitFont(ctx, text, 900, 32, 800);
  ctx.font = font(size, 800);
  const w = Math.min(1000, ctx.measureText(text).width + 64);
  ctx.fillStyle = C.amber;
  roundRect(ctx, (VIDEO_WIDTH - w) / 2, 158, w, 62, 31);
  ctx.fill();
  ctx.fillStyle = C.amberText;
  ctx.fillText(text, VIDEO_WIDTH / 2, 190);
}

function drawHeader(ctx: Ctx2D, sim: Simulation, frame: FrameState, meta: RenderMeta): void {
  const { home, away } = sim.script.teams;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawCompetitionPill(ctx, meta.competition);
  // Equipos y marcador.
  drawBadge(ctx, home, 190, 330, 52);
  drawBadge(ctx, away, 890, 330, 52);
  for (const [team, cx] of [[home, 190], [away, 890]] as const) {
    fitFont(ctx, team.style.short, 320, 34, 700);
    ctx.fillStyle = C.text;
    ctx.fillText(team.style.short, cx, 408);
  }
  ctx.fillStyle = C.text;
  ctx.font = font(132, 800);
  ctx.fillText(String(frame.score.home), 400, 335);
  ctx.fillText(String(frame.score.away), 680, 335);
  ctx.font = font(80, 600);
  ctx.fillStyle = C.muted;
  ctx.fillText('–', 540, 332);
  // Cronómetro.
  ctx.font = font(34, 700);
  const cw = Math.max(150, ctx.measureText(frame.clock).width + 48);
  ctx.fillStyle = C.panel;
  roundRect(ctx, (VIDEO_WIDTH - cw) / 2, 432, cw, 52, 26);
  ctx.fill();
  ctx.fillStyle = C.text;
  ctx.fillText(frame.clock, VIDEO_WIDTH / 2, 459);
}

function drawPlayer(ctx: Ctx2D, p: PlayerFrame, team: ResolvedTeam, pulse: number): void {
  const x = px(p.x);
  const y = py(p.y);
  const r = 21;
  ctx.fillStyle = C.shadow;
  ctx.beginPath();
  ctx.ellipse(x + 3, y + 7, r, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  if (p.hasBall) {
    ctx.strokeStyle = C.highlight;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, r + 7 + pulse * 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = p.role === 'GK' ? team.style.keeper : team.style.primary;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = team.style.secondary;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = p.role === 'GK' ? '#0b1220' : team.style.textOnPrimary;
  ctx.font = font(22, 800);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(p.number), x, y + 1);
}

function drawBall(ctx: Ctx2D, frame: FrameState): void {
  if (!frame.ball.visible) return;
  const x = px(frame.ball.x);
  const y = py(frame.ball.y);
  const lift = frame.ball.z * 14;
  ctx.fillStyle = C.shadow;
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 6, 11, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  const r = 12 + frame.ball.z * 1.3;
  ctx.fillStyle = C.ball;
  ctx.strokeStyle = C.ballSpot;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y - lift, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.ballSpot;
  ctx.beginPath();
  ctx.arc(x, y - lift, r * 0.38, 0, Math.PI * 2);
  ctx.fill();
}

function drawTicker(ctx: Ctx2D, frame: FrameState): void {
  if (frame.ticker === null) return;
  const text = `${frame.ticker.clock}  ${frame.ticker.text}`;
  const size = fitFont(ctx, text, 900, 36, 700);
  ctx.font = font(size, 700);
  const w = Math.min(960, ctx.measureText(text).width + 64);
  ctx.fillStyle = C.panel;
  roundRect(ctx, (VIDEO_WIDTH - w) / 2, 1690, w, 72, 36);
  ctx.fill();
  ctx.fillStyle = C.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, VIDEO_WIDTH / 2, 1727);
}

function drawGoalBanner(ctx: Ctx2D, sim: Simulation, banner: NonNullable<FrameState['goalBanner']>): void {
  const team = sim.script.teams[banner.side];
  const p = banner.progress;
  const pop = p < 0.15 ? smoothstep(p / 0.15) * 1.12 : 1.12 - 0.12 * smoothstep((p - 0.15) / 0.15);
  const alpha = p > 0.8 ? 1 - (p - 0.8) / 0.2 : 1;
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  if (p < 0.08) {
    ctx.fillStyle = `rgba(255,255,255,${String(0.35 * (1 - p / 0.08))})`;
    ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
  }
  ctx.translate(VIDEO_WIDTH / 2, PITCH_Y0 + PITCH_RECT.height / 2);
  ctx.scale(pop, pop);
  ctx.fillStyle = team.style.primary;
  roundRect(ctx, -420, -170, 840, 340, 48);
  ctx.fill();
  ctx.strokeStyle = team.style.secondary;
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.fillStyle = team.style.textOnPrimary;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(168, 800);
  ctx.fillText('¡GOL!', 0, -40);
  const sub = `${team.style.short}${banner.shirt === null ? '' : ` · nº ${String(banner.shirt)}`} · ${banner.clock}`;
  fitFont(ctx, sub, 760, 44, 700);
  ctx.fillText(sub, 0, 90);
  ctx.restore();
}

function statRow(ctx: Ctx2D, label: string, a: number, b: number, y: number): void {
  ctx.textBaseline = 'middle';
  ctx.font = font(44, 800);
  ctx.fillStyle = C.text;
  ctx.textAlign = 'left';
  ctx.fillText(String(a), 250, y);
  ctx.textAlign = 'right';
  ctx.fillText(String(b), 830, y);
  ctx.textAlign = 'center';
  ctx.font = font(32, 600);
  ctx.fillStyle = C.muted;
  ctx.fillText(label, VIDEO_WIDTH / 2, y);
}

export function drawCard(ctx: Ctx2D, sim: Simulation, frame: FrameState, title: string, alpha: number, withStats = true): void {
  const { home, away } = sim.script.teams;
  const stats = statsAt(sim.script.events, frame.t);
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.fillStyle = C.overlay;
  ctx.fillRect(0, PITCH_Y0 - 30, VIDEO_WIDTH, PITCH_RECT.height + 60);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = C.amber;
  ctx.font = font(72, 800);
  ctx.fillText(title, VIDEO_WIDTH / 2, 700);
  drawBadge(ctx, home, 250, 850, 56);
  drawBadge(ctx, away, 830, 850, 56);
  ctx.fillStyle = C.text;
  ctx.font = font(150, 800);
  ctx.fillText(`${String(frame.score.home)} – ${String(frame.score.away)}`, VIDEO_WIDTH / 2, 850);
  if (withStats) {
    statRow(ctx, 'Tiros', stats.home.shots, stats.away.shots, 1030);
    statRow(ctx, 'A puerta', stats.home.onTarget, stats.away.onTarget, 1110);
    statRow(ctx, 'Córners', stats.home.corners, stats.away.corners, 1190);
    statRow(ctx, 'Faltas', stats.home.fouls, stats.away.fouls, 1270);
  }
  ctx.restore();
}

export function drawIntro(ctx: Ctx2D, sim: Simulation, meta: RenderMeta, progress: number): void {
  const { home, away } = sim.script.teams;
  const alpha = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1;
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.fillStyle = C.overlay;
  ctx.fillRect(0, PITCH_Y0 - 30, VIDEO_WIDTH, PITCH_RECT.height + 60);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawBadge(ctx, home, 540, 740, 80);
  ctx.fillStyle = C.text;
  fitFont(ctx, home.style.short, 900, 76, 800);
  ctx.fillText(home.style.short, 540, 870);
  ctx.fillStyle = C.amber;
  ctx.font = font(60, 800);
  ctx.fillText('VS', 540, 960);
  drawBadge(ctx, away, 540, 1090, 80);
  ctx.fillStyle = C.text;
  fitFont(ctx, away.style.short, 900, 76, 800);
  ctx.fillText(away.style.short, 540, 1220);
  ctx.fillStyle = C.muted;
  fitFont(ctx, meta.when, 960, 34, 600);
  ctx.fillText(meta.when, 540, 1340);
  ctx.restore();
}

/** Dibuja el fotograma `t` (segundos). Misma función para la vista previa y para la exportación. */
export function drawFrame(ctx: Ctx2D, sim: Simulation, t: number, meta: RenderMeta): void {
  const frame = sim.frame(t);
  const { home, away } = sim.script.teams;
  const phase = phaseAt(sim.script, frame.t);
  drawBackground(ctx);
  drawHeader(ctx, sim, frame, meta);
  ctx.drawImage(pitchCanvas(), 0, 0);

  const pulse = 0.5 + 0.5 * Math.sin(frame.t * 9);
  for (const p of frame.players) drawPlayer(ctx, p, p.side === 'home' ? home : away, pulse);
  if (frame.passLine !== null) {
    ctx.strokeStyle = C.passLine;
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 12]);
    ctx.beginPath();
    ctx.moveTo(px(frame.passLine.from.x), py(frame.passLine.from.y));
    ctx.lineTo(px(frame.ball.x), py(frame.ball.y));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  drawBall(ctx, frame);
  drawTicker(ctx, frame);
  if (frame.goalBanner !== null) drawGoalBanner(ctx, sim, frame.goalBanner);

  if (phase.kind === 'intro') drawIntro(ctx, sim, meta, frame.phaseProgress);
  else if (phase.kind === 'halftime') {
    const span = phase.t1 - phase.t0;
    const e = frame.t - phase.t0;
    const alpha = Math.min(smoothstep(e / 0.5), smoothstep((span - e) / 0.5));
    drawCard(ctx, sim, frame, 'DESCANSO', alpha, false);
  } else if (phase.kind === 'fulltime') {
    drawCard(ctx, sim, frame, 'FINAL', smoothstep((frame.t - phase.t0) / 0.6));
  }
}

/** Texto descriptivo del ganador para accesibilidad y nombres de archivo. */
export function sideName(sim: Simulation, side: Side): string {
  return sim.script.teams[side].name;
}
