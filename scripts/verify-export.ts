/**
 * Verificación de la exportación de vídeo con herramientas externas (no forma parte de `npm run ci`: necesita Chromium y ffmpeg).
 *
 *  1. Ejecuta el exportador REAL (`src/features/export/exportVideo.ts`) en Chromium con el códec que sí codifica el sandbox (VP9 en
 *     MP4) y valida el archivo con ffprobe/ffmpeg: contenedor, códec, 1080×1920, 30 fps, nº de fotogramas, duración, fastStart y
 *     decodificación sin errores.
 *  2. H.264: el Chromium del sandbox no incluye el codificador H.264, así que se comprueba el empaquetado que haría mediabunny:
 *     fotogramas de la propia app → ffmpeg/libx264 → desmux con mediabunny → remux con la misma configuración del exportador → ffprobe.
 *
 *  Uso: npm run verify:export
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from '@playwright/test';
import { ALL_FORMATS, BufferSource, BufferTarget, EncodedPacketSink, EncodedVideoPacketSource, Input, Mp4OutputFormat, Output } from 'mediabunny';
import { createServer } from 'vite';

type ExporterModule = typeof import('../src/features/export/exportVideo.ts');
type EngineModule = typeof import('../src/engine/index.ts');
type RenderersModule = typeof import('../src/features/simulation/renderers.ts');
const MODULES = {
  exporter: '/src/features/export/exportVideo.ts',
  engine: '/src/engine/index.ts',
  renderers: '/src/features/simulation/renderers.ts',
} as const;

const OUT = join(process.cwd(), 'e2e', 'artifacts');
mkdirSync(OUT, { recursive: true });

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}: ${detail}`);
};

interface Probe {
  streams: { codec_name: string; codec_tag_string: string; width: number; height: number; r_frame_rate: string; nb_read_frames?: string; pix_fmt?: string; profile?: string; duration?: string }[];
  format: { format_name: string; duration: string; size: string };
}

function probe(file: string): Probe {
  const out = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out) as Probe;
}

/** Orden de las cajas de primer nivel del MP4 (fastStart ⇒ `moov` antes que `mdat`). */
function topLevelBoxes(file: string): string[] {
  const data = readFileSync(file);
  const boxes: string[] = [];
  let pos = 0;
  while (pos + 8 <= data.length && boxes.length < 12) {
    let size = data.readUInt32BE(pos);
    const type = data.toString('latin1', pos + 4, pos + 8);
    boxes.push(type);
    if (size === 1) size = Number(data.readBigUInt64BE(pos + 8));
    if (size < 8) break;
    pos += size;
  }
  return boxes;
}

function decodeClean(file: string): boolean {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
  return r.status === 0 && r.stderr.trim() === '';
}

async function main(): Promise<void> {
  const codec = process.env['VERIFY_CODEC'] ?? 'vp9';
  const seed = 2024;
  const score = { home: 2, away: 1 };

  const server = await createServer({
    server: { host: '127.0.0.1', port: 5199, strictPort: true },
    // Pre-optimizado para que Vite no recargue la página a mitad de la exportación.
    optimizeDeps: { include: ['mediabunny'] },
    logLevel: 'error',
  });
  await server.listen();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Página mínima (sin dependencias): el código de la app se importa desde el servidor de Vite.
    await page.goto('http://127.0.0.1:5199/favicon.svg');

    // ---- 1. Exportador real en el navegador ------------------------------------------------------------------------------
    const t0 = Date.now();
    const exported = await page.evaluate(
      async ({ codec: c, seed: s, score: sc, modules }) => {
        // Se cargan desde el servidor de Vite (código real de la app); las rutas llegan como variables para que no se resuelvan en Node.
        const exporter = (await import(/* @vite-ignore */ modules.exporter)) as ExporterModule;
        const engine = (await import(/* @vite-ignore */ modules.engine)) as EngineModule;
        const sim = engine.simulateArena({ seed: s, home: 'Real Madrid', away: 'FC Barcelona', score: sc });
        const meta = { competition: 'LaLiga 2026-27 · Jornada 8', when: 'sábado, 24 de octubre de 2026 · 12:30' };
        let last = 0;
        const result = await exporter.exportVideo({
          sim,
          meta,
          style: 'arena',
          codec: c as 'vp9',
          title: 'Prueba',
          onProgress: (p) => {
            last = p.frame;
          },
        });
        const bytes = new Uint8Array(await result.blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { base64: btoa(bin), frames: result.frames, duration: result.durationSeconds, simDuration: sim.script.duration, progressFrames: last, width: result.width, height: result.height, fps: result.fps, bytes: result.bytes };
      },
      { codec, seed, score, modules: MODULES },
    );
    const file = join(OUT, `export-${codec}.mp4`);
    writeFileSync(file, Buffer.from(exported.base64, 'base64'));
    console.log(`Exportación (${codec}) en ${((Date.now() - t0) / 1000).toFixed(1)} s → ${file} (${(exported.bytes / 1e6).toFixed(1)} MB)`);

    const p = probe(file);
    const v = p.streams[0];
    check('contenedor MP4', p.format.format_name.includes('mp4'), p.format.format_name);
    check(`códec ${codec}`, v?.codec_name === codec, v?.codec_name ?? 'sin vídeo');
    check('resolución 1080×1920 (9:16)', v?.width === 1080 && v.height === 1920, `${String(v?.width)}×${String(v?.height)}`);
    check('30 fps', v?.r_frame_rate === '30/1', v?.r_frame_rate ?? '?');
    check('nº de fotogramas = esperado', Number(v?.nb_read_frames) === exported.frames, `${String(v?.nb_read_frames)} vs ${String(exported.frames)}`);
    check('progreso llegó al último fotograma', exported.progressFrames === exported.frames, String(exported.progressFrames));
    check('duración ≈ la de la simulación', Math.abs(Number(p.format.duration) - exported.simDuration) < 0.1, `${Number(p.format.duration).toFixed(2)} s vs ${exported.simDuration.toFixed(2)} s`);
    const audioOut = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name,duration', '-of', 'json', file], { encoding: 'utf8' });
    const audioStreams = (JSON.parse(audioOut) as { streams: { codec_name: string; duration: string }[] }).streams;
    const a = audioStreams[0];
    check('pista de audio (AAC u Opus) con la duración del vídeo', a !== undefined && Math.abs(Number(a.duration) - exported.simDuration) < 0.15, a === undefined ? 'sin audio' : `${a.codec_name}, ${Number(a.duration).toFixed(2)} s`);
    const boxes = topLevelBoxes(file);
    check('fastStart (moov antes que mdat)', boxes.indexOf('moov') >= 0 && boxes.indexOf('moov') < boxes.indexOf('mdat'), boxes.join(','));
    check('se decodifica completo sin errores (ffmpeg)', decodeClean(file), 'ffmpeg -f null');
    for (const t of [1, exported.simDuration * 0.3, exported.simDuration * 0.6, exported.simDuration - 1].map((x) => Math.round(x))) {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', file, '-frames:v', '1', join(OUT, `export-${codec}-t${String(t)}.png`)]);
    }

    // ---- 2. H.264: empaquetado de mediabunny con fotogramas de la app codificados por libx264 ---------------------------------
    const framesDir = join(OUT, 'frames');
    rmSync(framesDir, { recursive: true, force: true });
    mkdirSync(framesDir, { recursive: true });
    const pngs = await page.evaluate(async ({ seed: s, score: sc, modules }) => {
      const render = (await import(/* @vite-ignore */ modules.renderers)) as RenderersModule;
      const engine = (await import(/* @vite-ignore */ modules.engine)) as EngineModule;
      const sim = engine.simulateArena({ seed: s, home: 'Real Madrid', away: 'FC Barcelona', score: sc });
      // Estamos en un documento SVG: se crea el canvas en el espacio de nombres XHTML.
      const canvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas') as HTMLCanvasElement;
      canvas.width = 1080;
      canvas.height = 1920;
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('sin contexto 2d');
      const out: string[] = [];
      for (let i = 0; i < 90; i += 1) {
        render.drawVideoFrame(ctx, sim, 12 + i / 30, { competition: 'LaLiga 2026-27 · Jornada 8', when: 'sábado, 24 de octubre de 2026 · 12:30' }, 'arena');
        out.push(canvas.toDataURL('image/png').split(',')[1] ?? '');
      }
      return out;
    }, { seed, score, modules: MODULES });
    pngs.forEach((b64, i) => { writeFileSync(join(framesDir, `f${String(i).padStart(4, '0')}.png`), Buffer.from(b64, 'base64')); });
    const x264 = join(OUT, 'x264-source.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '30', '-i', join(framesDir, 'f%04d.png'), '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-b:v', '6M', '-movflags', '+faststart', x264]);

    const input = new Input({ source: new BufferSource(readFileSync(x264)), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (track === null) throw new Error('El MP4 de libx264 no tiene pista de vídeo');
    const decoderConfig = await track.getDecoderConfig();
    const sink = new EncodedPacketSink(track);
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const source = new EncodedVideoPacketSource('avc');
    output.addVideoTrack(source, { frameRate: 30 });
    await output.start();
    let first = true;
    for await (const packet of sink.packets()) {
      await source.add(packet, first ? { decoderConfig: decoderConfig ?? undefined } : undefined);
      first = false;
    }
    await output.finalize();
    const remux = join(OUT, 'remux-h264.mp4');
    writeFileSync(remux, Buffer.from(target.buffer ?? new ArrayBuffer(0)));
    const h = probe(remux).streams[0];
    check('H.264 (mediabunny avc): códec h264 / avc1', h?.codec_name === 'h264' && h.codec_tag_string === 'avc1', `${String(h?.codec_name)}/${String(h?.codec_tag_string)} ${String(h?.profile)}`);
    check('H.264: 1080×1920, yuv420p, 30 fps', h?.width === 1080 && h.height === 1920 && h.pix_fmt === 'yuv420p' && h.r_frame_rate === '30/1', `${String(h?.width)}×${String(h?.height)} ${String(h?.pix_fmt)} ${String(h?.r_frame_rate)}`);
    check('H.264: 90 fotogramas y decodifica limpio', Number(h?.nb_read_frames) === 90 && decodeClean(remux), `${String(h?.nb_read_frames)} fotogramas`);
    const hb = topLevelBoxes(remux);
    check('H.264: fastStart', hb.indexOf('moov') < hb.indexOf('mdat'), hb.join(','));
  } finally {
    await browser.close();
    await server.close();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} comprobaciones correctas`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
