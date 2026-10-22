import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { BatchQueue, uniqueName, type JobRunner } from './batchQueue.ts';
import { ExportError } from './errors.ts';
import type { ExportResult } from './exportVideo.ts';
import { buildZip, zipReadme } from './zip.ts';

const fakeResult = (seed: number, size = 4): ExportResult => ({
  blob: new Blob([new Uint8Array(size).fill(seed % 250)], { type: 'video/mp4' }),
  codec: 'avc',
  audio: null,
  width: 1080,
  height: 1920,
  fps: 30,
  frames: 30,
  durationSeconds: 1,
  bytes: size,
});

interface Deferred {
  readonly seed: number;
  resolve: () => void;
  reject: (e: unknown) => void;
  signal: AbortSignal;
  progress: (r: number) => void;
}

/** Generador controlado a mano: cada trabajo queda a la espera hasta que el test lo resuelve. */
function manualRunner(): { runner: JobRunner; pending: Deferred[]; maxConcurrent: () => number } {
  const pending: Deferred[] = [];
  let active = 0;
  let max = 0;
  const runner: JobRunner = (job, signal, onProgress) =>
    new Promise<ExportResult>((resolve, reject) => {
      active += 1;
      max = Math.max(max, active);
      const finish = (): void => {
        active -= 1;
      };
      pending.push({
        seed: job.seed,
        signal,
        progress: onProgress,
        resolve: () => {
          finish();
          resolve(fakeResult(job.seed));
        },
        reject: (e) => {
          finish();
          reject(e instanceof Error ? e : new Error(String(e)));
        },
      });
      signal.addEventListener('abort', () => {
        finish();
        reject(new ExportError('cancelled', 'cancelada'));
      });
    });
  return { runner, pending, maxConcurrent: () => max };
}

const tick = (): Promise<void> => new Promise((r) => { setTimeout(r, 0); });
const statuses = (q: BatchQueue): string[] => q.snapshot().jobs.map((j) => j.status);

describe('nombres únicos', () => {
  it('añade -2, -3 antes de la extensión', () => {
    expect(uniqueName('a.mp4', new Set())).toBe('a.mp4');
    expect(uniqueName('a.mp4', new Set(['a.mp4']))).toBe('a-2.mp4');
    expect(uniqueName('a.mp4', new Set(['a.mp4', 'a-2.mp4']))).toBe('a-3.mp4');
    expect(uniqueName('sin-extension', new Set(['sin-extension']))).toBe('sin-extension-2');
  });
});

describe('BatchQueue', () => {
  it('procesa los trabajos de uno en uno y en orden, con progreso', async () => {
    const { runner, pending, maxConcurrent } = manualRunner();
    const q = new BatchQueue(runner);
    q.add([{ seed: 1, fileName: 'a.mp4', data: null }, { seed: 2, fileName: 'b.mp4', data: null }, { seed: 3, fileName: 'c.mp4', data: null }]);
    const finished = q.start();
    await tick();
    expect(statuses(q)).toEqual(['running', 'pending', 'pending']);
    expect(pending).toHaveLength(1);
    pending[0]?.progress(0.5);
    expect(q.snapshot().jobs[0]?.progress).toBe(0.5);
    pending[0]?.resolve();
    await tick();
    expect(statuses(q)).toEqual(['done', 'running', 'pending']);
    pending[1]?.resolve();
    await tick();
    pending[2]?.resolve();
    await finished;
    expect(statuses(q)).toEqual(['done', 'done', 'done']);
    expect(maxConcurrent()).toBe(1);
    expect(q.snapshot().running).toBe(false);
    expect(q.snapshot().jobs.every((j) => j.result?.bytes === 4 && j.progress === 1)).toBe(true);
  });

  it('un fallo no detiene a los demás y se puede reintentar sólo el fallido', async () => {
    const { runner, pending } = manualRunner();
    const q = new BatchQueue(runner);
    q.add([{ seed: 1, fileName: 'a.mp4', data: null }, { seed: 2, fileName: 'b.mp4', data: null }, { seed: 3, fileName: 'c.mp4', data: null }]);
    const finished = q.start();
    await tick();
    pending[0]?.resolve();
    await tick();
    pending[1]?.reject(new Error('el codificador falló'));
    await tick();
    pending[2]?.resolve();
    await finished;
    expect(statuses(q)).toEqual(['done', 'error', 'done']);
    const failed = q.snapshot().jobs[1];
    expect(failed?.error?.kind).toBe('encode-failed');
    expect(failed?.error?.message).toContain('el codificador falló');
    const second = q.retryFailed();
    await tick();
    expect(pending).toHaveLength(4);
    pending[3]?.resolve();
    await second;
    expect(statuses(q)).toEqual(['done', 'done', 'done']);
    expect(q.snapshot().jobs[1]?.attempts).toBe(2);
  });

  it('cancelar aborta el vídeo en curso y marca las pendientes; luego se pueden reintentar', async () => {
    const { runner, pending } = manualRunner();
    const q = new BatchQueue(runner);
    q.add([{ seed: 1, fileName: 'a.mp4', data: null }, { seed: 2, fileName: 'b.mp4', data: null }, { seed: 3, fileName: 'c.mp4', data: null }]);
    const finished = q.start();
    await tick();
    pending[0]?.progress(0.3);
    q.cancel();
    expect(pending[0]?.signal.aborted).toBe(true);
    await finished;
    expect(statuses(q)).toEqual(['cancelled', 'cancelled', 'cancelled']);
    expect(q.snapshot().running).toBe(false);
    expect(pending).toHaveLength(1);
    const again = q.retry(q.snapshot().jobs[1]?.id ?? '');
    await tick();
    expect(statuses(q)).toEqual(['cancelled', 'running', 'cancelled']);
    pending[1]?.resolve();
    await again;
    expect(statuses(q)).toEqual(['cancelled', 'done', 'cancelled']);
  });

  it('falta de memoria: se pausa, conserva las pendientes y reanuda cuando se libera', async () => {
    const { runner, pending } = manualRunner();
    const released: ExportResult[] = [];
    const q = new BatchQueue(runner, (r) => released.push(r));
    q.add([{ seed: 1, fileName: 'a.mp4', data: null }, { seed: 2, fileName: 'b.mp4', data: null }, { seed: 3, fileName: 'c.mp4', data: null }]);
    const run = q.start();
    await tick();
    pending[0]?.resolve();
    await tick();
    pending[1]?.reject(new RangeError('Array buffer allocation failed'));
    await run;
    expect(statuses(q)).toEqual(['done', 'error', 'pending']);
    expect(q.snapshot().paused?.kind).toBe('out-of-memory');
    // El usuario quita el vídeo terminado para liberar memoria y reanuda.
    q.remove(q.snapshot().jobs[0]?.id ?? '');
    expect(released).toHaveLength(1);
    const resumed = q.resume();
    await tick();
    expect(q.snapshot().paused).toBeNull();
    expect(statuses(q)).toEqual(['error', 'running']);
    pending[2]?.resolve();
    await resumed;
    expect(statuses(q)).toEqual(['error', 'done']);
  });

  it('quitar un trabajo en curso lo cancela y libera lo que produjera; vaciar libera todo', async () => {
    const { runner, pending } = manualRunner();
    const released: ExportResult[] = [];
    const q = new BatchQueue(runner, (r) => released.push(r));
    q.add([{ seed: 1, fileName: 'a.mp4', data: null }, { seed: 2, fileName: 'b.mp4', data: null }]);
    const run = q.start();
    await tick();
    pending[0]?.resolve();
    await tick();
    q.remove(q.snapshot().jobs[1]?.id ?? '');
    expect(pending[1]?.signal.aborted).toBe(true);
    await run;
    expect(q.snapshot().jobs).toHaveLength(1);
    q.clear();
    expect(released).toHaveLength(1);
    expect(q.snapshot().jobs).toHaveLength(0);
  });

  it('los nombres de archivo repetidos se hacen únicos y notifica a los suscriptores', () => {
    const { runner } = manualRunner();
    const q = new BatchQueue(runner);
    let calls = 0;
    const off = q.subscribe(() => { calls += 1; });
    q.add([{ seed: 1, fileName: 'a.mp4', data: null }, { seed: 1, fileName: 'a.mp4', data: null }]);
    expect(q.snapshot().jobs.map((j) => j.fileName)).toEqual(['a.mp4', 'a-2.mp4']);
    expect(calls).toBeGreaterThan(0);
    off();
    const before = calls;
    q.add([{ seed: 3, fileName: 'c.mp4', data: null }]);
    expect(calls).toBe(before);
    // El snapshot es estable mientras no hay cambios (requisito de useSyncExternalStore).
    expect(q.snapshot()).toBe(q.snapshot());
  });

  it('start() mientras corre no lanza una segunda cola', async () => {
    const { runner, pending, maxConcurrent } = manualRunner();
    const q = new BatchQueue(runner);
    q.add([{ seed: 1, fileName: 'a.mp4', data: null }, { seed: 2, fileName: 'b.mp4', data: null }]);
    const a = q.start();
    const b = q.start();
    expect(a).toBe(b);
    await tick();
    pending[0]?.resolve();
    await tick();
    pending[1]?.resolve();
    await a;
    expect(maxConcurrent()).toBe(1);
  });
});

describe('ZIP de descargas', () => {
  it('contiene LEEME.txt y todos los vídeos con sus bytes, con nombres únicos', async () => {
    const a = new Blob([new Uint8Array([1, 2, 3, 4, 5])]);
    const b = new Blob([new Uint8Array(200_000).fill(7)]);
    const blob = await buildZip([{ name: 'a.mp4', blob: a }, { name: 'a.mp4', blob: b }, { name: 'vacio.mp4', blob: new Blob([]) }], zipReadme(['- a.mp4 (semilla 1)']));
    expect(blob.type).toBe('application/zip');
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['LEEME.txt', 'a-2.mp4', 'a.mp4', 'vacio.mp4']);
    expect([...(files['a.mp4'] ?? [])]).toEqual([1, 2, 3, 4, 5]);
    expect(files['a-2.mp4']?.length).toBe(200_000);
    expect(files['a-2.mp4']?.every((x) => x === 7)).toBe(true);
    expect(files['vacio.mp4']?.length).toBe(0);
    const readme = strFromU8(files['LEEME.txt'] ?? new Uint8Array());
    expect(readme).toContain('SIMULACIONES FICTICIAS');
    expect(readme).toContain('semilla 1');
  });
});
