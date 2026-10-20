import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, canEncodeVideo, type VideoCodec } from 'mediabunny';

import type { Simulation } from '../../engine/index.ts';
import type { RenderMeta } from '../simulation/render.ts';
import { drawVideoFrame, type VideoStyle } from '../simulation/renderers.ts';
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from '../simulation/theme.ts';
import { PRODUCT_CODEC, codecLabel } from './codec.ts';
import { ExportError, classifyExportError, codecUnsupported, unsupportedBrowser } from './errors.ts';

export const DEFAULT_BITRATE = 6_000_000;

export interface ExportProgress {
  /** Fotogramas ya codificados. */
  readonly frame: number;
  readonly total: number;
  /** 0–1. */
  readonly ratio: number;
  readonly stage: 'codificando' | 'finalizando';
}

export interface ExportOptions {
  readonly sim: Simulation;
  readonly meta: RenderMeta;
  readonly style: VideoStyle;
  readonly codec?: VideoCodec;
  readonly fps?: number;
  readonly bitrate?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ExportProgress) => void;
  /** Título que se guarda en los metadatos del MP4. */
  readonly title?: string;
}

export interface ExportResult {
  readonly blob: Blob;
  readonly codec: VideoCodec;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frames: number;
  readonly durationSeconds: number;
  readonly bytes: number;
}

export interface SupportCheck {
  readonly supported: boolean;
  /** Mensaje listo para el usuario cuando no hay soporte. */
  readonly error: ExportError | null;
}

/** ¿Puede este navegador codificar el códec a 1080×1920? Comprueba `VideoEncoder` y `isConfigSupported` (vía mediabunny). */
export async function checkExportSupport(codec: VideoCodec = PRODUCT_CODEC, fps = VIDEO_FPS, bitrate = DEFAULT_BITRATE): Promise<SupportCheck> {
  if (typeof VideoEncoder === 'undefined') return { supported: false, error: unsupportedBrowser() };
  try {
    const ok = await canEncodeVideo(codec, { width: VIDEO_WIDTH, height: VIDEO_HEIGHT, frameRate: fps, quality: new Quality({ bitrate }) });
    return ok ? { supported: true, error: null } : { supported: false, error: codecUnsupported(`vídeo ${codecLabel(codec)}`, VIDEO_WIDTH, VIDEO_HEIGHT) };
  } catch (error) {
    return { supported: false, error: classifyExportError(error) };
  }
}

function createCanvas(): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(VIDEO_WIDTH, VIDEO_HEIGHT);
  const canvas = document.createElement('canvas');
  canvas.width = VIDEO_WIDTH;
  canvas.height = VIDEO_HEIGHT;
  return canvas;
}

const yieldToUi = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

/**
 * Exporta la simulación a un MP4 vertical 1080×1920: renderiza fotograma a fotograma (no en tiempo real) con la misma función de
 * dibujo que la vista previa y lo codifica con WebCodecs; `mediabunny` lo empaqueta (metadatos al principio: fastStart).
 * No finge nada: si el navegador no soporta el códec lanza `ExportError` con el mensaje para el usuario.
 */
export async function exportVideo(options: ExportOptions): Promise<ExportResult> {
  const { sim, meta, style, signal, onProgress } = options;
  const codec = options.codec ?? PRODUCT_CODEC;
  const fps = options.fps ?? VIDEO_FPS;
  const bitrate = options.bitrate ?? DEFAULT_BITRATE;
  const aborted = (): boolean => signal?.aborted === true;
  if (aborted()) throw new ExportError('cancelled', 'Exportación cancelada.');

  const support = await checkExportSupport(codec, fps, bitrate);
  if (!support.supported && support.error !== null) throw support.error;

  const canvas = createCanvas();
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new ExportError('encode-failed', 'No se pudo crear el lienzo de dibujo.');

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const source = new CanvasSource(canvas, { codec, quality: new Quality({ bitrate }), keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: fps });
  if (options.title !== undefined) output.setMetadataTags({ title: options.title, comment: 'Simulación ficticia' });

  const total = Math.max(1, Math.ceil(sim.script.duration * fps));
  const cancelQuietly = async (): Promise<void> => {
    try {
      await output.cancel();
    } catch (error) {
      console.warn('No se pudo liberar el codificador tras el fallo', error);
    }
  };

  try {
    await output.start();
    for (let i = 0; i < total; i += 1) {
      if (aborted()) throw new ExportError('cancelled', 'Exportación cancelada.');
      drawVideoFrame(ctx, sim, i / fps, meta, style);
      await source.add(i / fps, 1 / fps);
      onProgress?.({ frame: i + 1, total, ratio: (i + 1) / total, stage: 'codificando' });
      if (i % 6 === 5) await yieldToUi();
    }
    onProgress?.({ frame: total, total, ratio: 1, stage: 'finalizando' });
    await output.finalize();
  } catch (error) {
    await cancelQuietly();
    throw classifyExportError(error);
  }

  const buffer = target.buffer;
  if (buffer === null) throw new ExportError('encode-failed', 'El codificador no produjo ningún archivo.');
  return {
    blob: new Blob([buffer], { type: 'video/mp4' }),
    codec,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    fps,
    frames: total,
    durationSeconds: total / fps,
    bytes: buffer.byteLength,
  };
}
