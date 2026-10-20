import { ExportError, classifyExportError } from './errors.ts';
import type { ExportResult } from './exportVideo.ts';

export type JobStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled';

export interface BatchJob<T = null> {
  readonly id: string;
  readonly seed: number;
  readonly fileName: string;
  readonly status: JobStatus;
  /** 0–1 del trabajo en curso. */
  readonly progress: number;
  readonly result: ExportResult | null;
  readonly error: ExportError | null;
  /** Veces que se ha intentado (para reintentos). */
  readonly attempts: number;
  /** Datos propios del trabajo (parámetros del vídeo); los define quien añade el trabajo. */
  readonly data: T;
}

export interface QueueSnapshot<T = null> {
  readonly jobs: readonly BatchJob<T>[];
  /** `true` mientras se está procesando la cola. */
  readonly running: boolean;
  /** Motivo por el que la cola se detuvo sola (p. ej. falta de memoria); `null` si no está en pausa. */
  readonly paused: ExportError | null;
}

export interface JobInput<T = null> {
  readonly seed: number;
  readonly fileName: string;
  readonly data: T;
}

/** Función que genera un vídeo. Debe respetar `signal` (lanzando `ExportError('cancelled')` o `AbortError`). */
export type JobRunner<T = null> = (job: Readonly<{ id: string; seed: number; fileName: string; data: T }>, signal: AbortSignal, onProgress: (ratio: number) => void) => Promise<ExportResult>;

/** Hace único `name` respecto a `taken` añadiendo `-2`, `-3`… antes de la extensión. */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}-${String(n)}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Cola secuencial (un vídeo cada vez) con progreso, cancelación, reintento y pausa si falta memoria.
 * No depende de React ni del navegador: el generador se inyecta (`JobRunner`).
 */
export class BatchQueue<T = null> {
  private jobs: BatchJob<T>[] = [];
  private paused: ExportError | null = null;
  private pump: Promise<void> | null = null;
  private abort: AbortController | null = null;
  private cancelling = false;
  private nextId = 1;
  private readonly listeners = new Set<() => void>();
  private cache: QueueSnapshot<T>;

  constructor(
    private readonly runner: JobRunner<T>,
    private readonly onRelease: (result: ExportResult) => void = () => undefined,
  ) {
    this.cache = this.build();
  }

  private build(): QueueSnapshot<T> {
    return { jobs: this.jobs, running: this.pump !== null, paused: this.paused };
  }

  private emit(): void {
    this.cache = this.build();
    for (const listener of this.listeners) listener();
  }

  /** Para `useSyncExternalStore`: devuelve siempre el mismo objeto mientras no cambie nada. */
  snapshot(): QueueSnapshot<T> {
    return this.cache;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private update(id: string, patch: Partial<BatchJob<T>>): void {
    this.jobs = this.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));
  }

  /** Añade trabajos (con nombres de archivo únicos) sin arrancar la cola. */
  add(inputs: readonly JobInput<T>[]): readonly string[] {
    const taken = new Set(this.jobs.map((j) => j.fileName));
    const ids: string[] = [];
    for (const input of inputs) {
      const fileName = uniqueName(input.fileName, taken);
      taken.add(fileName);
      const id = `job-${String(this.nextId)}`;
      this.nextId += 1;
      ids.push(id);
      this.jobs = [...this.jobs, { id, seed: input.seed, fileName, status: 'pending', progress: 0, result: null, error: null, attempts: 0, data: input.data }];
    }
    this.emit();
    return ids;
  }

  /** Procesa los trabajos pendientes en orden. Devuelve una promesa que se resuelve cuando la cola termina o se pausa. */
  start(): Promise<void> {
    if (this.pump !== null) return this.pump;
    this.paused = null;
    this.cancelling = false;
    const run = this.process().finally(() => {
      this.pump = null;
      this.abort = null;
      this.emit();
    });
    this.pump = run;
    this.emit();
    return run;
  }

  private async process(): Promise<void> {
    for (;;) {
      if (this.paused !== null || this.cancelling) return;
      const job = this.jobs.find((j) => j.status === 'pending');
      if (job === undefined) return;
      const controller = new AbortController();
      this.abort = controller;
      this.update(job.id, { status: 'running', progress: 0, error: null, attempts: job.attempts + 1 });
      this.emit();
      try {
        const result = await this.runner({ id: job.id, seed: job.seed, fileName: job.fileName, data: job.data }, controller.signal, (ratio) => {
          this.update(job.id, { progress: Math.min(1, Math.max(0, ratio)) });
          this.emit();
        });
        if (this.removed(job.id)) {
          this.onRelease(result);
        } else {
          this.update(job.id, { status: 'done', progress: 1, result });
        }
      } catch (raw) {
        const error = classifyExportError(raw);
        if (error.kind === 'cancelled') {
          if (!this.removed(job.id)) this.update(job.id, { status: 'cancelled', progress: 0, error: null });
        } else {
          if (!this.removed(job.id)) this.update(job.id, { status: 'error', progress: 0, error });
          // Sin memoria: seguir sería fallar de nuevo. Se pausa hasta que el usuario libere vídeos.
          if (error.kind === 'out-of-memory') this.paused = error;
        }
      }
      this.emit();
    }
  }

  private removed(id: string): boolean {
    return !this.jobs.some((j) => j.id === id);
  }

  /** Cancela el vídeo en curso y marca como canceladas las pendientes. */
  cancel(): void {
    this.cancelling = true;
    this.abort?.abort();
    this.jobs = this.jobs.map((j) => (j.status === 'pending' ? { ...j, status: 'cancelled' as const } : j));
    this.emit();
  }

  /** Vuelve a poner en cola un trabajo fallido o cancelado y arranca la cola. */
  retry(id: string): Promise<void> {
    const job = this.jobs.find((j) => j.id === id);
    if (job?.status !== 'error' && job?.status !== 'cancelled') return this.pump ?? Promise.resolve();
    this.update(id, { status: 'pending', error: null, progress: 0 });
    return this.start();
  }

  /** Reintenta todos los fallidos y cancelados. */
  retryFailed(): Promise<void> {
    this.jobs = this.jobs.map((j) => (j.status === 'error' || j.status === 'cancelled' ? { ...j, status: 'pending' as const, error: null, progress: 0 } : j));
    this.emit();
    return this.start();
  }

  /** Reanuda tras una pausa (p. ej. después de liberar memoria). */
  resume(): Promise<void> {
    this.paused = null;
    this.emit();
    return this.start();
  }

  /** Quita un trabajo (si está en curso, lo cancela) y libera su resultado. */
  remove(id: string): void {
    const job = this.jobs.find((j) => j.id === id);
    if (job === undefined) return;
    if (job.status === 'running') this.abort?.abort();
    if (job.result !== null) this.onRelease(job.result);
    this.jobs = this.jobs.filter((j) => j.id !== id);
    this.emit();
  }

  /** Vacía la lista (cancela lo que haya en curso y libera todos los resultados). */
  clear(): void {
    this.cancel();
    for (const job of this.jobs) if (job.result !== null) this.onRelease(job.result);
    this.jobs = [];
    this.paused = null;
    this.emit();
  }
}
