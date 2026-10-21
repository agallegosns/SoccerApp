import { phaseAt, statsAt } from '../../engine/animate.ts';
import { clamp, smoothstep } from '../../engine/geometry.ts';
import { mulberry32 } from '../../engine/rng.ts';
import type { FrameState, ResolvedTeam, ScriptEvent, Simulation } from '../../engine/index.ts';
import { ARENA, BALL_PX, DISC_R, GATE_DEPTH, MOUTH_HALF, ballRoll, ballState, bounceEvents, cameraAngle, rotate, smoothDiscPositions, toScreen } from './arena.ts';
import type { BounceLevel } from './bounce.ts';
import { drawCrest } from './crest.ts';
import { THEMES, goalTextOf, type ThemeId, type ThemePalette } from './options.ts';
import { drawCard, drawCompetitionPill, drawHook, drawIntro, drawWatermark, fitFont, font, optionsOf, roundRect, type Ctx2D, type RenderMeta } from './render.ts';
import { CANVAS_THEME as C, VIDEO_HEIGHT, VIDEO_WIDTH } from './theme.ts';

const R = ARENA.radius;
const GOLD = '#fde047';

type Layer = HTMLCanvasElement | OffscreenCanvas;
const layers = new Map<ThemeId, Layer>();

function makeLayer(): Layer {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(VIDEO_WIDTH, VIDEO_HEIGHT);
  const canvas = document.createElement('canvas');
  canvas.width = VIDEO_WIDTH;
  canvas.height = VIDEO_HEIGHT;
  return canvas;
}

/** Capa fija (no depende de la rotación ni del tiempo): degradado de fondo, halo del aro y suelo de la arena. Una sola copia por fotograma. */
function arenaLayer(theme: ThemeId): Layer {
  const cached = layers.get(theme);
  if (cached !== undefined) return cached;
  const pal = THEMES[theme];
  const layer = makeLayer();
  const ctx: Ctx2D | null = layer.getContext('2d');
  if (ctx === null) throw new Error('No se pudo crear el lienzo de la arena');
  const bg = ctx.createLinearGradient(0, 0, 0, VIDEO_HEIGHT);
  bg.addColorStop(0, pal.bgTop);
  bg.addColorStop(0.5, pal.bgMid);
  bg.addColorStop(1, pal.bgTop);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
  const halo = ctx.createRadialGradient(ARENA.cx, ARENA.cy, R * 0.9, ARENA.cx, ARENA.cy, R * 1.45);
  halo.addColorStop(0, pal.halo);
  halo.addColorStop(1, pal.haloOff);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(ARENA.cx, ARENA.cy, R * 1.45, 0, Math.PI * 2);
  ctx.fill();
  const floor = ctx.createRadialGradient(ARENA.cx, ARENA.cy - R * 0.2, R * 0.05, ARENA.cx, ARENA.cy, R);
  floor.addColorStop(0, pal.floor[0]);
  floor.addColorStop(0.65, pal.floor[1]);
  floor.addColorStop(1, pal.floor[2]);
  ctx.fillStyle = floor;
  ctx.beginPath();
  ctx.arc(ARENA.cx, ARENA.cy, R, 0, Math.PI * 2);
  ctx.fill();
  layers.set(theme, layer);
  return layer;
}

function other(side: 'home' | 'away'): 'home' | 'away' {
  return side === 'home' ? 'away' : 'home';
}

const GLOW_R = 440;

function drawBackground(ctx: Ctx2D, sim: Simulation, frame: FrameState, theme: ThemeId): void {
  ctx.drawImage(arenaLayer(theme), 0, 0);
  // Resplandor del equipo con la posesión (sólo se rellena el cuadrado que lo contiene).
  for (const side of ['home', 'away'] as const) {
    const team = sim.script.teams[side];
    const x = side === 'home' ? 140 : VIDEO_WIDTH - 140;
    const y = side === 'home' ? 760 : 1380;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, GLOW_R);
    glow.addColorStop(0, team.style.primary);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.1 + 0.2 * frame.possession[side];
    ctx.fillStyle = glow;
    ctx.fillRect(x - GLOW_R, y - GLOW_R, 2 * GLOW_R, 2 * GLOW_R);
  }
  ctx.globalAlpha = 1;
  // Polvo de estadio: puntos que derivan despacio (función pura del tiempo).
  const rand = mulberry32(7);
  ctx.fillStyle = 'rgba(180, 205, 255, 0.35)';
  for (let i = 0; i < 46; i += 1) {
    const x = rand() * VIDEO_WIDTH;
    const y0 = rand() * VIDEO_HEIGHT;
    const speed = 8 + rand() * 18;
    const y = (y0 - frame.t * speed + VIDEO_HEIGHT * 4) % VIDEO_HEIGHT;
    ctx.globalAlpha = 0.15 + rand() * 0.35;
    ctx.beginPath();
    ctx.arc(x, y, 1.5 + rand() * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawBolt(ctx: Ctx2D, x: number, y: number, size: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + size * 0.1, y - size);
  ctx.lineTo(x - size * 0.55, y + size * 0.1);
  ctx.lineTo(x - size * 0.05, y + size * 0.1);
  ctx.lineTo(x - size * 0.15, y + size);
  ctx.lineTo(x + size * 0.55, y - size * 0.15);
  ctx.lineTo(x + size * 0.05, y - size * 0.15);
  ctx.closePath();
  ctx.fill();
}

function drawHeader(ctx: Ctx2D, sim: Simulation, frame: FrameState, meta: RenderMeta, sprint: 'home' | 'away' | null): void {
  const { home, away } = sim.script.teams;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawCompetitionPill(ctx, meta.competition);

  for (const [team, cx] of [[home, 175], [away, VIDEO_WIDTH - 175]] as const) {
    drawCrest(ctx, team, cx, 352, 72);
    fitFont(ctx, team.style.short, 310, 34, 800);
    ctx.fillStyle = C.text;
    ctx.textAlign = 'center';
    ctx.fillText(team.style.short, cx, 452);
    if (sprint === team.side) {
      drawBolt(ctx, cx - 56, 494, 15, GOLD);
      ctx.font = font(28, 800);
      ctx.fillStyle = GOLD;
      ctx.textAlign = 'left';
      ctx.fillText('SPRINT', cx - 36, 495);
      ctx.textAlign = 'center';
    }
  }
  ctx.fillStyle = C.text;
  ctx.font = font(150, 800);
  ctx.textAlign = 'center';
  ctx.fillText(String(frame.score.home), 400, 345);
  ctx.fillText(String(frame.score.away), 680, 345);
  ctx.font = font(84, 700);
  ctx.fillStyle = C.muted;
  ctx.fillText(':', 540, 338);
  ctx.font = font(36, 800);
  const cw = Math.max(150, ctx.measureText(frame.clock).width + 52);
  ctx.fillStyle = 'rgba(20, 32, 60, 0.95)';
  roundRect(ctx, (VIDEO_WIDTH - cw) / 2, 446, cw, 56, 28);
  ctx.fill();
  ctx.strokeStyle = 'rgba(147, 197, 253, 0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = C.text;
  ctx.fillText(frame.clock, VIDEO_WIDTH / 2, 475);
}

/** Rotación de la cámara: aplica a todo el escenario (porterías, balón y escudos). */
function drawFloorMarks(ctx: Ctx2D, angle: number): void {
  ctx.save();
  ctx.translate(ARENA.cx, ARENA.cy);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.arc(0, 0, R - 3, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  for (let i = 0; i < 12; i += 2) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, (i * Math.PI) / 6, ((i + 1) * Math.PI) / 6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-R, 0);
  ctx.lineTo(R, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.26, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.fill();
  // Áreas pequeñas junto a cada portería.
  ctx.lineWidth = 3;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(0, dir * R, R * 0.32, dir < 0 ? 0 : Math.PI, dir < 0 ? Math.PI : Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRing(ctx: Ctx2D, angle: number, color: string): void {
  const gap = Math.asin(MOUTH_HALF);
  ctx.save();
  ctx.translate(ARENA.cx, ARENA.cy);
  ctx.rotate(angle);
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  // Arcos entre las dos bocas (arriba = −90°, abajo = +90°).
  ctx.beginPath();
  ctx.arc(0, 0, R, -Math.PI / 2 + gap, Math.PI / 2 - gap);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, R, Math.PI / 2 + gap, (3 * Math.PI) / 2 - gap);
  ctx.stroke();
  ctx.restore();
}

function drawGate(ctx: Ctx2D, angle: number, top: boolean, color: string, glow: number): void {
  const w = MOUTH_HALF * R;
  const d = GATE_DEPTH * R;
  ctx.save();
  ctx.translate(ARENA.cx, ARENA.cy);
  ctx.rotate(angle);
  ctx.scale(1, top ? -1 : 1); // la portería de arriba se dibuja reflejada en su marco local
  const y0 = R - 2;
  // Red.
  ctx.save();
  ctx.beginPath();
  ctx.rect(-w, y0, 2 * w, d);
  ctx.clip();
  ctx.fillStyle = `rgba(255,255,255,${String(0.06 + 0.22 * glow)})`;
  ctx.fillRect(-w, y0, 2 * w, d);
  ctx.strokeStyle = `rgba(255,255,255,${String(0.22 + 0.4 * glow)})`;
  ctx.lineWidth = 2;
  for (let k = -w; k <= w; k += 14) {
    ctx.beginPath();
    ctx.moveTo(k, y0);
    ctx.lineTo(k, y0 + d);
    ctx.stroke();
  }
  for (let k = y0; k <= y0 + d; k += 14) {
    ctx.beginPath();
    ctx.moveTo(-w, k);
    ctx.lineTo(w, k);
    ctx.stroke();
  }
  ctx.restore();
  // Marco.
  ctx.shadowColor = color;
  ctx.shadowBlur = 18 + 30 * glow;
  ctx.strokeStyle = color;
  ctx.lineWidth = 14;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-w, y0);
  ctx.lineTo(-w, y0 + d);
  ctx.lineTo(w, y0 + d);
  ctx.lineTo(w, y0);
  ctx.stroke();
  ctx.restore();
}

interface DiscPos {
  readonly x: number;
  readonly y: number;
}

function drawDisc(ctx: Ctx2D, team: ResolvedTeam, pos: DiscPos, active: number, pulse: number): void {
  if (active > 0.01) {
    ctx.save();
    ctx.shadowColor = team.style.primary;
    ctx.shadowBlur = 40 * active + 8 * pulse;
    ctx.strokeStyle = team.style.secondary;
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.4 + 0.6 * active;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, DISC_R + 10 + 4 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  drawCrest(ctx, team, pos.x, pos.y, DISC_R);
}

function drawBall(ctx: Ctx2D, frame: FrameState, t: number, sim: Simulation, level: BounceLevel, trailOn: boolean): void {
  if (!frame.ball.visible) return;
  // Estela: posiciones recientes del balón.
  const trail: { x: number; y: number }[] = [];
  for (let k = trailOn ? 7 : 0; k >= 1; k -= 1) {
    const b = ballState(sim, Math.max(0, t - k * 0.035), level);
    if (!b.visible) continue;
    trail.push(b);
  }
  for (const [i, q] of trail.entries()) {
    ctx.fillStyle = `rgba(255,255,255,${String(0.05 + (0.22 * (i + 1)) / trail.length)})`;
    ctx.beginPath();
    ctx.arc(q.x, q.y, BALL_PX * (0.35 + (0.55 * (i + 1)) / trail.length), 0, Math.PI * 2);
    ctx.fill();
  }
  const p = ballState(sim, t, level);
  const lift = p.z * 10;
  const r = BALL_PX * (1 + p.z * 0.06);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(p.x + 3, p.y + 8, r * 0.95, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(p.x - r * 0.35, p.y - lift - r * 0.4, r * 0.1, p.x, p.y - lift, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#cfd8ea');
  ctx.fillStyle = g;
  ctx.strokeStyle = '#0b1220';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(p.x, p.y - lift, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Dibujo que rueda: tres manchas oscuras que giran alrededor de un eje perpendicular al avance (más estrechas cuanto más de canto).
  const roll = ballRoll(sim, t, level) / r;
  const ahead = ballState(sim, t + 0.03, level);
  const behind = ballState(sim, t - 0.03, level);
  const heading = Math.atan2(ahead.y - behind.y, ahead.x - behind.x);
  ctx.fillStyle = '#0b1220';
  for (let k = 0; k < 3; k += 1) {
    const a = roll + (k * 2 * Math.PI) / 3;
    const facing = Math.cos(a);
    if (facing <= 0.05) continue;
    ctx.beginPath();
    ctx.ellipse(p.x + Math.cos(heading) * Math.sin(a) * r * 0.62, p.y - lift + Math.sin(heading) * Math.sin(a) * r * 0.62, r * 0.3 * facing, r * 0.3, heading, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Destello del aro en cada rebote del balón: un arco brillante que se apaga y unas chispas. */
function drawBounceFlashes(ctx: Ctx2D, sim: Simulation, t: number, level: BounceLevel, ringColor: string): void {
  for (const [index, e] of bounceEvents(sim, level).entries()) {
    const age = t - e.t;
    if (age < 0 || age > 0.45) continue;
    const k = age / 0.45;
    const angle = cameraAngle(t) + Math.atan2(e.v, e.u);
    ctx.save();
    ctx.translate(ARENA.cx, ARENA.cy);
    ctx.strokeStyle = ringColor;
    ctx.shadowColor = ringColor;
    ctx.shadowBlur = 30 * (1 - k);
    ctx.globalAlpha = 1 - k;
    ctx.lineWidth = 16 + 10 * (1 - k);
    ctx.lineCap = 'round';
    const spread = 0.12 + 0.35 * k;
    ctx.beginPath();
    ctx.arc(0, 0, R, angle - spread, angle + spread);
    ctx.stroke();
    ctx.restore();
    const p = toScreen(rotate({ u: Math.cos(angle) * 0.98, v: Math.sin(angle) * 0.98 }, 0));
    burst(ctx, 5000 + index * 131, p.x, p.y, age, [ringColor, GOLD], 7, 0.45);
  }
}

const TAGS: Readonly<Partial<Record<ScriptEvent['type'], { text: string; color: string }>>> = {
  save: { text: '¡PARADA!', color: '#67e8f9' },
  miss: { text: 'FUERA', color: '#cbd5e1' },
  post: { text: '¡AL PALO!', color: '#fbbf24' },
  block: { text: 'BLOQUEO', color: '#fda4af' },
  foul: { text: 'FALTA', color: '#fcd34d' },
  corner: { text: 'CÓRNER', color: '#a5b4fc' },
};

function burst(ctx: Ctx2D, seed: number, x: number, y: number, age: number, colors: readonly string[], count: number, power: number): void {
  const rand = mulberry32(seed);
  for (let i = 0; i < count; i += 1) {
    const a = rand() * Math.PI * 2;
    const speed = (120 + rand() * 360) * power;
    const life = 0.55 + rand() * 0.7;
    const color = colors[Math.floor(rand() * colors.length)] ?? '#ffffff';
    const size = 3 + rand() * 6;
    if (age > life) continue;
    const dist = (speed * (1 - Math.exp(-age * 3))) / 3;
    const k = 1 - age / life;
    ctx.globalAlpha = clamp(k, 0, 1);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * dist, y + Math.sin(a) * dist + 40 * age * age, size * (0.4 + 0.6 * k), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawEffects(ctx: Ctx2D, sim: Simulation, t: number, level: BounceLevel): void {
  const { teams } = sim.script;
  for (const [index, e] of sim.script.events.entries()) {
    const age = t - e.t;
    if (age < 0) break;
    if (age > 1.6 || e.type === 'kickoff' || e.type === 'shot' || e.type === 'halftime' || e.type === 'fulltime') continue;
    const p = ballState(sim, e.t, level);
    const seed = index * 7919 + 13;
    if (e.type === 'goal' && e.side !== null) {
      const team = teams[e.side];
      const ring = clamp(age / 0.9, 0, 1);
      ctx.strokeStyle = team.style.secondary;
      ctx.globalAlpha = 1 - ring;
      ctx.lineWidth = 16 * (1 - ring) + 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 40 + ring * 520, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      burst(ctx, seed, p.x, p.y, age, [team.style.primary, team.style.secondary, GOLD, '#ffffff'], 46, 1.15);
      continue;
    }
    burst(ctx, seed, p.x, p.y, age, ['#ffffff', TAGS[e.type]?.color ?? '#ffffff'], e.type === 'post' ? 22 : 14, 0.7);
    const tag = TAGS[e.type];
    if (tag === undefined) continue;
    const pop = age < 0.18 ? smoothstep(age / 0.18) * 1.15 : 1.15 - 0.15 * smoothstep((age - 0.18) / 0.2);
    ctx.save();
    ctx.globalAlpha = clamp(1 - (age - 0.9) / 0.7, 0, 1);
    ctx.translate(clamp(p.x, 200, VIDEO_WIDTH - 200), clamp(p.y - 110 - age * 30, 560, 1500));
    ctx.scale(pop, pop);
    ctx.font = font(52, 800);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(tag.text).width + 48;
    ctx.fillStyle = 'rgba(8, 14, 30, 0.88)';
    roundRect(ctx, -w / 2, -36, w, 72, 36);
    ctx.fill();
    ctx.strokeStyle = tag.color;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = tag.color;
    ctx.fillText(tag.text, 0, 3);
    ctx.restore();
  }
}

function shakeOffset(sim: Simulation, t: number): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const e of sim.script.events) {
    if (e.t > t) break;
    const age = t - e.t;
    if (e.type === 'goal' && age < 0.7) {
      const amp = 18 * Math.exp(-age * 7);
      x += amp * Math.sin(age * 70);
      y += amp * Math.cos(age * 58);
    }
  }
  return { x, y };
}

function drawGoalBanner(ctx: Ctx2D, sim: Simulation, banner: NonNullable<FrameState['goalBanner']>, goalText: string): void {
  const team = sim.script.teams[banner.side];
  const p = banner.progress;
  const pop = p < 0.14 ? smoothstep(p / 0.14) * 1.1 : 1.1 - 0.1 * smoothstep((p - 0.14) / 0.2);
  const alpha = p > 0.78 ? 1 - (p - 0.78) / 0.22 : 1;
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  if (p < 0.07) {
    ctx.fillStyle = `rgba(255,255,255,${String(0.3 * (1 - p / 0.07))})`;
    ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
  }
  ctx.translate(VIDEO_WIDTH / 2, ARENA.cy);
  ctx.scale(pop, pop);
  const grad = ctx.createLinearGradient(-430, 0, 430, 0);
  grad.addColorStop(0, team.style.primary);
  grad.addColorStop(1, 'rgba(10, 18, 40, 0.96)');
  ctx.shadowColor = team.style.primary;
  ctx.shadowBlur = 50;
  ctx.fillStyle = grad;
  roundRect(ctx, -430, -150, 860, 300, 44);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = team.style.secondary;
  ctx.lineWidth = 6;
  ctx.stroke();
  drawCrest(ctx, team, -290, 0, 92);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  fitFont(ctx, goalText, 470, 150, 800);
  ctx.fillText(goalText, 90, -34);
  const sub = `${team.style.short}${banner.shirt === null ? '' : ` · nº ${String(banner.shirt)}`} · ${banner.clock}`;
  fitFont(ctx, sub, 520, 40, 700);
  ctx.fillStyle = '#e8eefc';
  ctx.fillText(sub, 90, 86);
  ctx.restore();
}

function statBar(ctx: Ctx2D, sim: Simulation, label: string, home: number, away: number, y: number): void {
  const { teams } = sim.script;
  const total = Math.max(1, home + away);
  const w = 290;
  const h = 14;
  ctx.textBaseline = 'middle';
  ctx.font = font(40, 800);
  ctx.fillStyle = C.text;
  ctx.textAlign = 'left';
  ctx.fillText(String(home), 90, y);
  ctx.textAlign = 'right';
  ctx.fillText(String(away), VIDEO_WIDTH - 90, y);
  ctx.textAlign = 'center';
  ctx.font = font(28, 700);
  ctx.fillStyle = C.muted;
  ctx.fillText(label, VIDEO_WIDTH / 2, y);
  for (const [side, x0, dir] of [['home', 170, 1], ['away', VIDEO_WIDTH - 170, -1]] as const) {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, dir > 0 ? x0 : x0 - w, y - h / 2, w, h, h / 2);
    ctx.fill();
    const value = side === 'home' ? home : away;
    const len = Math.max(value === 0 ? 0 : 14, (w * value) / total);
    ctx.fillStyle = teams[side].style.primary;
    roundRect(ctx, dir > 0 ? x0 : x0 - len, y - h / 2, len, h, h / 2);
    ctx.fill();
  }
}

function drawTicker(ctx: Ctx2D, frame: FrameState): void {
  if (frame.ticker === null) return;
  const text = `${frame.ticker.clock}  ${frame.ticker.text}`;
  const size = fitFont(ctx, text, 880, 36, 700);
  ctx.font = font(size, 700);
  const w = Math.min(960, ctx.measureText(text).width + 70);
  ctx.fillStyle = 'rgba(20, 32, 60, 0.95)';
  roundRect(ctx, (VIDEO_WIDTH - w) / 2, 1596, w, 70, 35);
  ctx.fill();
  ctx.strokeStyle = 'rgba(147, 197, 253, 0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = C.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, VIDEO_WIDTH / 2, 1632);
}

/** Estilo «Arena»: el partido simulado dentro de un círculo con dos porterías que giran, un escudo por equipo y el balón. */
export function drawArenaFrame(ctx: Ctx2D, sim: Simulation, t: number, meta: RenderMeta): void {
  const frame = sim.frame(t);
  const phase = phaseAt(sim.script, frame.t);
  const { home, away } = sim.script.teams;
  const angle = cameraAngle(frame.t);
  const sprint = phase.kind === 'attack' && phase.side !== null && frame.phaseProgress < 0.9 ? phase.side : null;
  const opts = optionsOf(meta);
  const pal: ThemePalette = THEMES[opts.theme];
  const level = opts.bounce;

  drawBackground(ctx, sim, frame, opts.theme);
  drawHeader(ctx, sim, frame, meta, sprint);

  const shake = shakeOffset(sim, frame.t);
  ctx.save();
  ctx.translate(shake.x, shake.y);
  drawFloorMarks(ctx, angle);
  drawRing(ctx, angle, pal.ring);
  drawBounceFlashes(ctx, sim, frame.t, level, pal.ring);
  // La portería de arriba es la del equipo que defiende ese lado (cambian de campo en la 2.ª parte).
  const topDefender = frame.half === 1 ? 'away' : 'home';
  const glowOf = (side: 'home' | 'away'): number => {
    let g = 0;
    for (const e of sim.script.events) {
      if (e.t > frame.t) break;
      if (e.type === 'goal' && e.side === other(side)) g = Math.max(g, 1 - (frame.t - e.t) / 1.2);
    }
    return clamp(g, 0, 1);
  };
  drawGate(ctx, angle, true, sim.script.teams[topDefender].style.primary, glowOf(topDefender));
  drawGate(ctx, angle, false, sim.script.teams[other(topDefender)].style.primary, glowOf(other(topDefender)));

  const discs = smoothDiscPositions(sim, frame.t, level);
  const pulse = 0.5 + 0.5 * Math.sin(frame.t * 10);
  for (const team of [home, away]) {
    // Estela de sprint.
    if (sprint === team.side) {
      for (let k = 6; k >= 1; k -= 1) {
        const prev = smoothDiscPositions(sim, Math.max(0, frame.t - k * 0.04), level)[team.side];
        ctx.fillStyle = `rgba(253, 224, 71, ${String(0.05 + 0.04 * (7 - k))})`;
        ctx.beginPath();
        ctx.arc(prev.x, prev.y, DISC_R * (0.5 + 0.08 * (7 - k)), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const holds = frame.players.some((p) => p.side === team.side && p.hasBall);
    drawDisc(ctx, team, discs[team.side], clamp(frame.possession[team.side] * (holds ? 1 : 0.55), 0, 1), pulse);
  }
  drawBall(ctx, frame, frame.t, sim, level, opts.ballTrail);
  ctx.restore();

  drawEffects(ctx, sim, frame.t, level);

  // Estadísticas en vivo (calculadas con los sucesos ya ocurridos) y último suceso.
  const live = statsAt(sim.script.events, frame.t);
  if (opts.showTicker) drawTicker(ctx, frame);
  if (opts.showStats) {
    statBar(ctx, sim, 'TIROS', live.home.shots, live.away.shots, 1726);
    statBar(ctx, sim, 'A PUERTA', live.home.onTarget, live.away.onTarget, 1784);
  }
  drawHook(ctx, opts.hook);
  drawWatermark(ctx, opts.watermark);

  if (frame.goalBanner !== null) drawGoalBanner(ctx, sim, frame.goalBanner, goalTextOf(opts));
  if (phase.kind === 'intro') drawIntro(ctx, sim, meta, frame.phaseProgress);
  else if (phase.kind === 'halftime') {
    const span = phase.t1 - phase.t0;
    const e = frame.t - phase.t0;
    drawCard(ctx, sim, frame, 'DESCANSO', Math.min(smoothstep(e / 0.5), smoothstep((span - e) / 0.5)), false);
  } else if (phase.kind === 'fulltime') {
    drawCard(ctx, sim, frame, 'FINAL', smoothstep((frame.t - phase.t0) / 0.6));
  }
}
