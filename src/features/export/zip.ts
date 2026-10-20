import { Zip, ZipPassThrough, strToU8 } from 'fflate';

import { uniqueName } from './batchQueue.ts';

export interface ZipEntry {
  readonly name: string;
  readonly blob: Blob;
}

/**
 * ZIP sin compresión (los MP4 ya están comprimidos) construido en streaming: cada vídeo se lee por trozos, de modo que no se
 * duplica en memoria. Incluye un LEEME.txt que recuerda que las simulaciones son ficticias.
 */
export async function buildZip(entries: readonly ZipEntry[], readme: string): Promise<Blob> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const state: { failure: Error | null } = { failure: null };
  const zip = new Zip((error, chunk) => {
    if (error !== null) state.failure = new Error(String(error));
    else parts.push(new Uint8Array(chunk));
  });

  const taken = new Set<string>(['LEEME.txt']);
  const readmeFile = new ZipPassThrough('LEEME.txt');
  zip.add(readmeFile);
  readmeFile.push(strToU8(readme), true);

  for (const entry of entries) {
    const name = uniqueName(entry.name, taken);
    taken.add(name);
    const file = new ZipPassThrough(name);
    zip.add(file);
    const reader = entry.blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        file.push(new Uint8Array(0), true);
        break;
      }
      file.push(value);
    }
  }
  zip.end();
  if (state.failure !== null) throw state.failure;
  return new Blob(parts, { type: 'application/zip' });
}

export function zipReadme(lines: readonly string[]): string {
  return [
    'SIMULACIONES FICTICIAS - futbol-sim',
    '',
    'Los vídeos de este archivo son simulaciones inventadas por ordenador. No son predicciones ni muestran partidos reales.',
    'Los partidos (equipos, competición, fecha) proceden de fuentes abiertas; los resultados y las jugadas son ficticios.',
    '',
    ...lines,
    '',
  ].join('\r\n');
}
