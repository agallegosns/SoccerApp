import type { VideoCodec } from 'mediabunny';

const ALLOWED: readonly VideoCodec[] = ['avc', 'vp9', 'av1'];

export function parseCodec(value: unknown): VideoCodec | null {
  return ALLOWED.find((c) => c === value) ?? null;
}

/**
 * Códec del producto: **H.264** (lo que TikTok y todos los móviles reproducen). `VITE_EXPORT_CODEC` sólo se usa al compilar para
 * pruebas en navegadores sin codificador H.264 (p. ej. el Chromium del sandbox, que sí codifica VP9).
 */
export const PRODUCT_CODEC: VideoCodec = parseCodec(import.meta.env['VITE_EXPORT_CODEC']) ?? 'avc';

export const CODEC_LABELS: Readonly<Partial<Record<VideoCodec, string>>> = { avc: 'H.264', vp9: 'VP9', av1: 'AV1', hevc: 'H.265', vp8: 'VP8' };

export const codecLabel = (codec: VideoCodec): string => CODEC_LABELS[codec] ?? codec;
