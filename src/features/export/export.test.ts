import { describe, expect, it } from 'vitest';

import { ExportError, classifyExportError, codecUnsupported, unsupportedBrowser } from './errors.ts';
import { exportFileName } from './fileName.ts';

describe('nombre de archivo', () => {
  it('liga_local_vs_visitante_fecha_semilla.mp4', () => {
    expect(exportFileName({ competition: 'LaLiga 2026-27', home: 'Real Madrid CF', away: 'FC Barcelona', date: '2026-10-24', seed: 12345 })).toBe(
      'laliga-2026-27_real-madrid-cf_vs_fc-barcelona_2026-10-24_12345.mp4',
    );
  });
  it('quita acentos y caracteres peligrosos', () => {
    const name = exportFileName({ competition: 'Champions League 2026-27', home: 'Atlético / Madrid', away: 'Bodø/Glimt?', date: '2026-09-15', seed: 7, extension: 'zip' });
    expect(name).toBe('champions-league-2026-27_atletico-madrid_vs_bodo-glimt_2026-09-15_7.zip');
    expect(name).toMatch(/^[a-z0-9._-]+$/);
  });
});

describe('errores de exportación', () => {
  it('los mensajes de soporte recomiendan navegadores concretos', () => {
    expect(unsupportedBrowser().message).toMatch(/Chrome, Edge o Safari recientes/);
    expect(codecUnsupported('vídeo H.264', 1080, 1920).message).toMatch(/H\.264 a 1080×1920.*Chrome, Edge o Safari recientes/);
    expect(codecUnsupported('vídeo H.264', 1080, 1920).kind).toBe('codec-unsupported');
  });
  it('clasifica fallos de memoria, cancelación y errores genéricos', () => {
    expect(classifyExportError(new RangeError('Array buffer allocation failed')).kind).toBe('out-of-memory');
    expect(classifyExportError(new DOMException('x', 'QuotaExceededError')).kind).toBe('out-of-memory');
    expect(classifyExportError(Object.assign(new Error('x'), { name: 'AbortError' })).kind).toBe('cancelled');
    const generic = classifyExportError(new Error('el codificador falló'));
    expect(generic.kind).toBe('encode-failed');
    expect(generic.message).toContain('el codificador falló');
    expect(classifyExportError('texto raro').kind).toBe('encode-failed');
  });
  it('un ExportError se conserva tal cual', () => {
    const e = new ExportError('cancelled', 'hola');
    expect(classifyExportError(e)).toBe(e);
  });
});
