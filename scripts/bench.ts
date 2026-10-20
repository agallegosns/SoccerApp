/**
 * Medición de rendimiento del dibujado y de la memoria durante la exportación (Chromium + servidor de Vite). No forma parte de `npm run ci`.
 *   npm run bench            → tiempos de dibujado de ambos estilos
 *   BENCH_EXPORT=1 npm run bench → además exporta un MP4 (VP9) midiendo el montón de JS
 */
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

type EngineModule = typeof import('../src/engine/index.ts');
type RenderersModule = typeof import('../src/features/simulation/renderers.ts');
type ExporterModule = typeof import('../src/features/export/exportVideo.ts');
const MODULES = {
  engine: '/src/engine/index.ts',
  renderers: '/src/features/simulation/renderers.ts',
  exporter: '/src/features/export/exportVideo.ts',
} as const;

interface Stats {
  readonly mean: number;
  readonly p95: number;
  readonly max: number;
  readonly samples: number;
}

async function main(): Promise<void> {
  const server = await createServer({ server: { host: '127.0.0.1', port: 5198, strictPort: true }, optimizeDeps: { include: ['mediabunny'] }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:5198/favicon.svg');

    const draw = await page.evaluate(async ({ modules }) => {
      const engine = (await import(/* @vite-ignore */ modules.engine)) as EngineModule;
      const renderers = (await import(/* @vite-ignore */ modules.renderers)) as RenderersModule;
      const canvas = new OffscreenCanvas(1080, 1920);
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('sin contexto 2d');
      const meta = { competition: 'LaLiga 2026-27 · Jornada 8', when: 'sábado, 24 de octubre de 2026 · 12:30' };
      const out: Record<string, { mean: number; p95: number; max: number; samples: number }> = {};
      const warmup: Record<string, number> = {};
      const t0 = performance.now();
      const sim = engine.simulate({ seed: 2024, home: 'Real Madrid', away: 'FC Barcelona', score: { home: 2, away: 1 } });
      const simulateMs = performance.now() - t0;
      const f0 = performance.now();
      for (let t = 0; t < sim.script.duration; t += 1 / 30) sim.frame(t);
      const frameAllMs = performance.now() - f0;
      for (const style of ['arena', 'tactical'] as const) {
        const times: number[] = [];
        // El primer dibujado incluye la creación de capas y el arranque del rasterizador: se mide aparte.
        const w0 = performance.now();
        renderers.drawVideoFrame(ctx, sim, 0, meta, style);
        ctx.getImageData(0, 0, 1, 1);
        warmup[style] = performance.now() - w0;
        for (let t = 0; t < sim.script.duration; t += 0.25) {
          const s = performance.now();
          renderers.drawVideoFrame(ctx, sim, t, meta, style);
          ctx.getImageData(0, 0, 1, 1); // fuerza la rasterización: sin esto sólo se mide el encolado de órdenes
          times.push(performance.now() - s);
        }
        times.sort((a, b) => a - b);
        out[style] = { mean: times.reduce((a, b) => a + b, 0) / times.length, p95: times[Math.floor(times.length * 0.95)] ?? 0, max: times.at(-1) ?? 0, samples: times.length };
      }
      return { out, warmup, simulateMs, frameAllMs, frames: Math.ceil(sim.script.duration * 30), duration: sim.script.duration };
    }, { modules: MODULES });
    console.log(`simulate(): ${draw.simulateMs.toFixed(1)} ms · frame() de los ${String(draw.frames)} fotogramas: ${draw.frameAllMs.toFixed(0)} ms (${(draw.frameAllMs / draw.frames).toFixed(3)} ms/fotograma)`);
    for (const [style, s] of Object.entries(draw.out) as [string, Stats][]) {
      console.log(`dibujado ${style}: primera vez ${(draw.warmup[style] ?? 0).toFixed(0)} ms · media ${s.mean.toFixed(2)} ms · p95 ${s.p95.toFixed(2)} ms · máx ${s.max.toFixed(2)} ms (${String(s.samples)} muestras)`);
    }

    if (process.env['BENCH_EXPORT'] === '1') {
      // Dos exportaciones seguidas: si se retuvieran fotogramas, el montón (tras forzar el GC) crecería de una a otra.
      const mem = await page.evaluate(async ({ modules }) => {
        const engine = (await import(/* @vite-ignore */ modules.engine)) as EngineModule;
        const exporter = (await import(/* @vite-ignore */ modules.exporter)) as ExporterModule;
        const gc = (globalThis as unknown as { gc: () => void }).gc;
        const heap = (): number => (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize;
        const settle = async (): Promise<number> => {
          for (let i = 0; i < 3; i += 1) {
            gc();
            await new Promise((r) => setTimeout(r, 50));
          }
          return heap();
        };
        const runs: { seconds: number; fps: number; fileMB: number; peakMB: number; afterGcMB: number }[] = [];
        const baseline = await settle();
        for (const seed of [2024, 2025]) {
          const sim = engine.simulate({ seed, home: 'Real Madrid', away: 'FC Barcelona', score: { home: 2, away: 1 } });
          let peak = 0;
          const start = performance.now();
          const result = await exporter.exportVideo({
            sim,
            meta: { competition: 'LaLiga 2026-27 · Jornada 8', when: 'sábado, 24 de octubre de 2026 · 12:30' },
            style: 'arena',
            codec: 'vp9',
            onProgress: (p) => {
              if (p.frame % 25 === 0) peak = Math.max(peak, heap());
            },
          });
          const seconds = (performance.now() - start) / 1000;
          const fileMB = result.bytes / 1e6;
          runs.push({ seconds, fps: result.frames / seconds, fileMB, peakMB: peak / 1e6, afterGcMB: (await settle()) / 1e6 });
        }
        return { baselineMB: baseline / 1e6, runs };
      }, { modules: MODULES });
      console.log(`montón JS en reposo: ${mem.baselineMB.toFixed(1)} MB`);
      mem.runs.forEach((r, i) => {
        console.log(`exportación ${String(i + 1)}: ${r.seconds.toFixed(1)} s (${r.fps.toFixed(1)} fps) · archivo ${r.fileMB.toFixed(1)} MB · pico del montón ${r.peakMB.toFixed(1)} MB · tras GC ${r.afterGcMB.toFixed(1)} MB`);
      });
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
