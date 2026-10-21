import type { ExportResult } from '../export/exportVideo.ts';
import { buildRecord, type VideoParams } from './model.ts';
import { upsertVideo } from './store.ts';

/** Guarda (o actualiza) la ficha de un vídeo recién exportado. */
export function recordExport(params: VideoParams, result: Pick<ExportResult, 'bytes' | 'durationSeconds'>, fileName: string): void {
  upsertVideo(buildRecord(params, { fileName, bytes: result.bytes, durationSeconds: result.durationSeconds }));
}
