import { AlertTriangle, Archive, Download, Eye, Layers, RotateCw, Trash2, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';

import type { Match } from '../../data/types.ts';
import { MAX_GOALS_PER_TEAM, simulate, type Pace, type Score } from '../../engine/index.ts';
import type { RenderMeta } from '../simulation/render.ts';
import type { VideoStyle } from '../simulation/renderers.ts';
import { BatchQueue, type BatchJob, type JobRunner } from './batchQueue.ts';
import { exportVideo } from './exportVideo.ts';
import { exportFileName, zipFileName } from './fileName.ts';
import { setBusy } from '../../app/busy.ts';
import { markDownloaded } from '../../data/downloaded.ts';
import { downloadBlob, useExportSupport } from './useExportSupport.ts';
import { buildZip, zipReadme } from './zip.ts';

/** Tope por lote: cada vídeo ocupa ≈ 35 MB en memoria hasta que se descarga o se quita. */
export const MAX_BATCH = 10;

interface Props {
  readonly match: Match;
  /** `YYYY-MM-DD` mostrada del partido (para los nombres de archivo). */
  readonly date: string;
  readonly currentSeed: number;
  readonly style: VideoStyle;
  /** Marcador fijado por el usuario o `null` (aleatorio por semilla). */
  readonly fixedScore: Score | null;
  readonly pace: Pace;
  readonly meta: RenderMeta;
  readonly onUseSeed: (seed: number) => void;
}

/** Parámetros con los que se genera cada vídeo (se fijan al añadirlo a la cola). */
interface JobData {
  readonly home: string;
  readonly away: string;
  readonly style: VideoStyle;
  readonly fixedScore: Score | null;
  readonly pace: Pace;
  readonly meta: RenderMeta;
  /** Marcador ficticio resultante (para mostrarlo en la lista). */
  readonly score: Score;
}

const STATUS_LABEL: Readonly<Record<BatchJob<JobData>['status'], string>> = {
  pending: 'En cola',
  running: 'Generando',
  done: 'Listo',
  error: 'Error',
  cancelled: 'Cancelado',
};

const randomSeed = (): number => Math.floor(Math.random() * 1_000_000_000);
const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`;

export function BatchPanel({ match, date, currentSeed, style, fixedScore, pace, meta, onUseSeed }: Props) {
  const support = useExportSupport();
  const [count, setCount] = useState(3);
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  const [queue] = useState(() => {
    const runner: JobRunner<JobData> = (job, signal, onProgress) => {
      const d = job.data;
      const sim = simulate({ seed: job.seed, home: d.home, away: d.away, score: d.fixedScore, pace: d.pace });
      return exportVideo({
        sim,
        meta: d.meta,
        style: d.style,
        signal,
        title: `Simulación ficticia: ${d.home} vs ${d.away}`,
        onProgress: (progress) => {
          onProgress(progress.ratio);
        },
      });
    };
    return new BatchQueue<JobData>(runner);
  });
  const snapshot = useSyncExternalStore(queue.subscribe.bind(queue), queue.snapshot.bind(queue));

  useEffect(
    () => () => {
      queue.clear();
    },
    [queue],
  );

  function generate(): void {
    const n = Math.min(MAX_BATCH, Math.max(1, Math.floor(count)));
    const tagOf = (seed: number, p: Pace, st: VideoStyle, sc: Score | null): string =>
      `${String(seed)}|${p}|${st}|${sc === null ? 'r' : `${String(sc.home)}-${String(sc.away)}`}`;
    const known = new Set(snapshot.jobs.map((j) => tagOf(j.seed, j.data.pace, j.data.style, j.data.fixedScore)));
    const seeds: number[] = [];
    const tag = (seed: number): string => tagOf(seed, pace, style, fixedScore);
    for (const candidate of [currentSeed]) if (!known.has(tag(candidate))) seeds.push(candidate);
    while (seeds.length < n) {
      const s = randomSeed();
      if (!known.has(tag(s)) && !seeds.includes(s)) seeds.push(s);
    }
    queue.add(
      seeds.slice(0, n).map((seed) => ({
        seed,
        fileName: exportFileName({ competition: match.competition, home: match.home, away: match.away, date, seed }),
        data: {
          home: match.home,
          away: match.away,
          style,
          fixedScore,
          pace,
          meta,
          score: simulate({ seed, home: match.home, away: match.away, score: fixedScore, pace }).script.score,
        },
      })),
    );
    void queue.start();
  }

  async function downloadZip(): Promise<void> {
    const done = snapshot.jobs.filter((j) => j.result !== null);
    if (done.length === 0) return;
    setZipping(true);
    setZipError(null);
    try {
      const lines = done.map((j) => {
        return `- ${j.fileName}: ${match.home} ${String(j.data.score.home)}-${String(j.data.score.away)} ${match.away} (semilla ${String(j.seed)})`;
      });
      const blob = await buildZip(
        done.flatMap((j) => (j.result === null ? [] : [{ name: j.fileName, blob: j.result.blob }])),
        zipReadme([`Partido: ${match.home} vs ${match.away} - ${match.competition} - ${date}`, '', ...lines]),
      );
      markDownloaded(match.id);
      downloadBlob(blob, zipFileName({ competition: match.competition, home: match.home, away: match.away, date }, done.length));
    } catch (error) {
      setZipError(error instanceof Error ? error.message : 'No se pudo crear el ZIP.');
    } finally {
      setZipping(false);
    }
  }

  const { jobs, running, paused } = snapshot;
  useEffect(() => {
    setBusy('batch', running);
    return () => { setBusy('batch', false); };
  }, [running]);
  const doneCount = jobs.filter((j) => j.status === 'done').length;
  const failedCount = jobs.filter((j) => j.status === 'error' || j.status === 'cancelled').length;
  const pendingCount = jobs.filter((j) => j.status === 'pending' || j.status === 'running').length;
  const bytes = jobs.reduce((a, j) => a + (j.result?.bytes ?? 0), 0);

  return (
    <div className="card batch" aria-label="Generar varias simulaciones" data-testid="batch-panel">
      <h2>Generar varias simulaciones</h2>
      <p className="muted">
        Cada vídeo usa una semilla distinta (jugadas, minutos y formaciones distintos del mismo partido). Se generan de uno en uno con los parámetros actuales
        (estilo {style === 'arena' ? 'Arena' : 'Táctico'}, ritmo {pace === 'fast' ? 'rápido' : 'normal'}, marcador {fixedScore === null ? 'aleatorio' : `${String(fixedScore.home)}–${String(fixedScore.away)}`}).
      </p>
      <div className="row">
        <label className="field batch__count">
          <span>Cantidad (1–{MAX_BATCH})</span>
          <input
            type="number"
            min={1}
            max={MAX_BATCH}
            value={count}
            onChange={(e) => {
              setCount(Math.min(MAX_BATCH, Math.max(1, Math.floor(Number(e.target.value) || 1))));
            }}
            data-testid="batch-count"
          />
        </label>
        <button type="button" className="btn btn--primary" onClick={generate} disabled={support.state !== 'ok' || running} data-testid="batch-generate">
          <Layers aria-hidden="true" size={20} />
          Generar {count} {count === 1 ? 'vídeo' : 'vídeos'}
        </button>
      </div>
      {fixedScore !== null && fixedScore.home + fixedScore.away > MAX_GOALS_PER_TEAM && <p className="muted">Con tantos goles cada vídeo dura más.</p>}
      {support.state === 'no' && (
        <p className="alert alert--error" role="alert" data-testid="batch-unsupported">
          <AlertTriangle aria-hidden="true" size={20} />
          <span>{support.error.message}</span>
        </p>
      )}

      {paused !== null && (
        <div className="alert alert--error" role="alert" data-testid="batch-paused">
          <AlertTriangle aria-hidden="true" size={20} />
          <div>
            <p>
              <strong>Cola en pausa.</strong> {paused.message}
            </p>
            <p className="muted">Descarga o quita los vídeos ya terminados para liberar memoria y pulsa «Reanudar».</p>
            <button type="button" className="btn" onClick={() => void queue.resume()} data-testid="batch-resume">
              Reanudar
            </button>
          </div>
        </div>
      )}

      {jobs.length > 0 && (
        <>
          <div className="batch__summary" role="status" data-testid="batch-summary">
            <strong>
              {doneCount} de {jobs.length} listos
            </strong>
            {bytes > 0 && <span className="muted"> · {mb(bytes)} en memoria</span>}
          </div>
          <div className="row">
            {running && (
              <button type="button" className="btn" onClick={() => { queue.cancel(); }} data-testid="batch-cancel">
                <X aria-hidden="true" size={18} />
                Cancelar todo
              </button>
            )}
            {!running && failedCount > 0 && (
              <button type="button" className="btn" onClick={() => void queue.retryFailed()} data-testid="batch-retry-all">
                <RotateCw aria-hidden="true" size={18} />
                Reintentar fallidos ({failedCount})
              </button>
            )}
            {doneCount > 0 && (
              <button type="button" className="btn btn--primary" onClick={() => void downloadZip()} disabled={zipping} data-testid="batch-zip">
                <Archive aria-hidden="true" size={18} />
                {zipping ? 'Creando ZIP…' : `Descargar todo (ZIP, ${String(doneCount)})`}
              </button>
            )}
            {!running && (
              <button type="button" className="btn" onClick={() => { queue.clear(); }} data-testid="batch-clear">
                <Trash2 aria-hidden="true" size={18} />
                Vaciar lista
              </button>
            )}
          </div>
          {zipError !== null && (
            <p className="alert alert--error" role="alert">
              {zipError}
            </p>
          )}
          {pendingCount > 0 && <p className="muted">Mantén esta pestaña abierta mientras se generan los vídeos.</p>}
          <ul className="plain-list batch__list" data-testid="batch-list">
            {jobs.map((job) => {
              return (
                <li key={job.id} className={`job job--${job.status}`} data-testid="batch-job" data-status={job.status}>
                  <div className="job__main">
                    <span className="job__title">
                      Semilla {job.seed}
                      <span className="job__score">
                        {' '}
                        · {job.data.home} {job.data.score.home}–{job.data.score.away} {job.data.away} (ficticio)
                      </span>
                    </span>
                    <span className={`job__status job__status--${job.status}`}>{STATUS_LABEL[job.status]}</span>
                  </div>
                  <span className="muted job__file">{job.fileName}</span>
                  {job.status === 'running' && <progress max={1} value={job.progress} aria-label={`Progreso de la semilla ${String(job.seed)}`} />}
                  {job.status === 'error' && job.error !== null && <p className="job__error">{job.error.message}</p>}
                  {job.result !== null && (
                    <span className="muted">
                      {mb(job.result.bytes)} · {job.result.durationSeconds.toFixed(1)} s
                    </span>
                  )}
                  <div className="row job__actions">
                    {job.result !== null && (
                      <button type="button" className="btn btn--small" onClick={() => { if (job.result !== null) { markDownloaded(match.id); downloadBlob(job.result.blob, job.fileName); } }} data-testid="job-download">
                        <Download aria-hidden="true" size={16} />
                        Descargar
                      </button>
                    )}
                    {(job.status === 'error' || job.status === 'cancelled') && (
                      <button type="button" className="btn btn--small" onClick={() => void queue.retry(job.id)} data-testid="job-retry">
                        <RotateCw aria-hidden="true" size={16} />
                        Reintentar
                      </button>
                    )}
                    <button type="button" className="btn btn--small" onClick={() => { onUseSeed(job.seed); }} data-testid="job-view">
                      <Eye aria-hidden="true" size={16} />
                      Ver en la vista previa
                    </button>
                    <button type="button" className="btn btn--small" onClick={() => { queue.remove(job.id); }} data-testid="job-remove">
                      <Trash2 aria-hidden="true" size={16} />
                      {job.status === 'running' ? 'Cancelar' : 'Quitar'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
