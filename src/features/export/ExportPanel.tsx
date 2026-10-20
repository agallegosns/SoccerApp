import { AlertTriangle, Download, Film, RotateCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { markDownloaded } from '../../data/downloaded.ts';
import type { Simulation } from '../../engine/index.ts';
import type { RenderMeta } from '../simulation/render.ts';
import type { VideoStyle } from '../simulation/renderers.ts';
import { VIDEO_FPS } from '../simulation/theme.ts';
import { ExportError, classifyExportError } from './errors.ts';
import { PRODUCT_CODEC, codecLabel } from './codec.ts';
import { exportVideo, type ExportProgress, type ExportResult } from './exportVideo.ts';
import { useExportSupport } from './useExportSupport.ts';

interface Props {
  readonly sim: Simulation;
  readonly meta: RenderMeta;
  readonly style: VideoStyle;
  readonly fileName: string;
  readonly title: string;
  /** Partido al que pertenece el vídeo: se marca como descargado (tarjeta verde en el calendario). */
  readonly matchId: string;
}

type Job =
  | { readonly phase: 'idle' }
  | { readonly phase: 'running'; readonly progress: ExportProgress; readonly etaSeconds: number | null }
  | { readonly phase: 'done'; readonly url: string; readonly result: ExportResult }
  | { readonly phase: 'error'; readonly error: ExportError };

const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`;

/** Exporta la simulación mostrada a un MP4 vertical 9:16. El estado se reinicia remontando el componente (key) al cambiar la simulación. */
export function ExportPanel({ sim, meta, style, fileName, title, matchId }: Props) {
  const support = useExportSupport();
  const [job, setJob] = useState<Job>({ phase: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  async function start(): Promise<void> {
    if (urlRef.current !== null) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = performance.now();
    setJob({ phase: 'running', progress: { frame: 0, total: 1, ratio: 0, stage: 'codificando' }, etaSeconds: null });
    let lastPaint = 0;
    try {
      const result = await exportVideo({
        sim,
        meta,
        style,
        title,
        signal: controller.signal,
        onProgress: (progress) => {
          const now = performance.now();
          if (progress.ratio >= 1 || now - lastPaint > 120) {
            lastPaint = now;
            const etaSeconds = progress.ratio > 0.03 ? Math.round((((now - startedAt) / progress.ratio) * (1 - progress.ratio)) / 1000) : null;
            setJob({ phase: 'running', progress, etaSeconds });
          }
        },
      });
      const url = URL.createObjectURL(result.blob);
      urlRef.current = url;
      setJob({ phase: 'done', url, result });
    } catch (error) {
      setJob({ phase: 'error', error: classifyExportError(error) });
    }
  }

  const running = job.phase === 'running';
  return (
    <div className="card export" aria-label="Exportar vídeo">
      <h2>Exportar vídeo</h2>
      <p className="muted">
        MP4 vertical 1080×1920 (9:16) · {VIDEO_FPS} fps · {codecLabel(PRODUCT_CODEC)} · {sim.script.duration.toFixed(0)} s. Después lo subes tú a TikTok.
      </p>

      {support.state === 'no' && (
        <div className="alert alert--error" role="alert" data-testid="export-unsupported">
          <AlertTriangle aria-hidden="true" size={20} />
          <div>
            <p>
              <strong>No se puede exportar en este navegador.</strong> {support.error.message}
            </p>
          </div>
        </div>
      )}

      {!running && (
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void start()}
          disabled={support.state !== 'ok'}
          data-testid="export-button"
        >
          <Film aria-hidden="true" size={20} />
          {job.phase === 'done' ? 'Volver a exportar' : 'Exportar MP4'}
        </button>
      )}

      {job.phase === 'running' && (
        <div className="export__progress" role="status" data-testid="export-progress">
          <progress max={1} value={job.progress.ratio} aria-label="Progreso de la exportación" />
          <p>
            {job.progress.stage === 'finalizando' ? 'Finalizando archivo…' : `Codificando fotograma ${String(job.progress.frame)} de ${String(job.progress.total)}`}{' '}
            ({Math.round(job.progress.ratio * 100)} %)
            {job.etaSeconds !== null && ` · quedan ≈ ${String(job.etaSeconds)} s`}
          </p>
          <button type="button" className="btn" onClick={() => { abortRef.current?.abort(); }} data-testid="export-cancel">
            <X aria-hidden="true" size={18} />
            Cancelar
          </button>
        </div>
      )}

      {job.phase === 'error' && (
        <div className="alert alert--error" role="alert" data-testid="export-error">
          <AlertTriangle aria-hidden="true" size={20} />
          <div>
            <p>
              <strong>{job.error.kind === 'cancelled' ? 'Exportación cancelada.' : 'La exportación falló.'}</strong>{' '}
              {job.error.kind === 'cancelled' ? '' : job.error.message}
            </p>
            {job.error.kind !== 'unsupported-browser' && job.error.kind !== 'codec-unsupported' && (
              <button type="button" className="btn" onClick={() => void start()}>
                <RotateCw aria-hidden="true" size={18} />
                Reintentar
              </button>
            )}
          </div>
        </div>
      )}

      {job.phase === 'done' && (
        <div className="export__result" data-testid="export-result">
          <p>
            <strong>{fileName}</strong>
            <br />
            <span className="muted">
              {mb(job.result.bytes)} · {job.result.width}×{job.result.height} · {job.result.fps} fps · {job.result.durationSeconds.toFixed(1)} s
            </span>
          </p>
          <video className="export__video" src={job.url} controls playsInline muted data-testid="export-video" />
          <a className="btn btn--primary" href={job.url} download={fileName} data-testid="download-link" onClick={() => { markDownloaded(matchId); }}>
            <Download aria-hidden="true" size={20} />
            Descargar MP4
          </a>
        </div>
      )}
    </div>
  );
}
