import { type KeyValueStore, readJson, removeKey, writeJson } from '../../data/cache.ts';
import { slug } from '../../data/dates.ts';

/** Escudos que sube el usuario (PNG, JPG o WebP). Se reducen y se guardan sólo en su navegador; la app no incluye escudos oficiales. */
export const MAX_CREST_FILE_BYTES = 3_000_000;
export const ACCEPTED_CREST_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];
export const CREST_SIZE = 256;

const isString = (value: unknown): value is string => typeof value === 'string';
const keyFor = (teamName: string): string => `crest:${slug(teamName)}`;

/** Mensaje de error si el archivo no sirve como escudo; `null` si es válido. */
export function validateCrestFile(file: { readonly type: string; readonly size: number }): string | null {
  if (!ACCEPTED_CREST_TYPES.includes(file.type)) return 'El escudo debe ser una imagen PNG, JPG o WebP.';
  if (file.size > MAX_CREST_FILE_BYTES) return `La imagen pesa demasiado (máximo ${String(MAX_CREST_FILE_BYTES / 1_000_000)} MB).`;
  if (file.size === 0) return 'El archivo está vacío.';
  return null;
}

export function readStoredCrest(teamName: string, store?: KeyValueStore | null): string | null {
  return readJson(keyFor(teamName), isString, store);
}

/** Guarda el escudo (data URL). Lanza `DataError('storage')` si no cabe en el almacenamiento del navegador. */
export function storeCrest(teamName: string, dataUrl: string, store?: KeyValueStore | null): void {
  writeJson(keyFor(teamName), dataUrl, store);
}

export function deleteCrest(teamName: string, store?: KeyValueStore | null): void {
  removeKey(keyFor(teamName), store);
}

/** Reduce la imagen a un cuadrado de 256 px (conservando proporciones, sobre fondo transparente) y la devuelve como data URL PNG. */
export async function fileToCrestDataUrl(file: Blob): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    throw new Error('No se pudo leer la imagen: puede estar dañada o no ser una imagen válida.', { cause: error });
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = CREST_SIZE;
    canvas.height = CREST_SIZE;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('No se pudo procesar la imagen.');
    const scale = Math.min(CREST_SIZE / bitmap.width, CREST_SIZE / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (CREST_SIZE - w) / 2, (CREST_SIZE - h) / 2, w, h);
    return canvas.toDataURL('image/png');
  } finally {
    bitmap.close();
  }
}

// ---- Registro en memoria que usa el dibujado (síncrono) --------------------------------------------------------------------------

interface Entry {
  readonly bitmap: ImageBitmap;
  readonly version: number;
}
const registry = new Map<string, Entry>();
let counter = 0;

/** Registra (o quita, con `null`) el escudo que debe dibujarse para un equipo. */
export function registerCrest(teamName: string, bitmap: ImageBitmap | null): void {
  const key = slug(teamName);
  registry.get(key)?.bitmap.close();
  if (bitmap === null) registry.delete(key);
  else {
    counter += 1;
    registry.set(key, { bitmap, version: counter });
  }
}

/** Escudo subido por el usuario para ese equipo, si lo hay. `version` cambia con cada escudo nuevo (invalida cachés). */
export function customCrest(teamName: string): Entry | null {
  return registry.get(slug(teamName)) ?? null;
}

/** Lee el escudo guardado del navegador y lo deja registrado. Devuelve `true` si había uno. */
export async function loadStoredCrest(teamName: string): Promise<boolean> {
  const dataUrl = readStoredCrest(teamName);
  if (dataUrl === null) {
    registerCrest(teamName, null);
    return false;
  }
  const blob = await (await fetch(dataUrl)).blob();
  registerCrest(teamName, await createImageBitmap(blob));
  return true;
}
