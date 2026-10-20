import { unzipSync, strFromU8 } from 'fflate';

import { DataError } from './types.ts';

/** Lector mínimo de .xlsx (zip + XML), suficiente para hojas de calendario. Sin dependencias del DOM. */
export type SheetCell = { readonly kind: 'number'; readonly value: number } | { readonly kind: 'text'; readonly value: string };
export type SheetRows = readonly (readonly (SheetCell | undefined)[])[];

const decodeEntities = (text: string): string =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

function textOf(xml: string): string {
  const withoutPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  const parts = [...withoutPhonetic.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1] ?? ''));
  return parts.join('');
}

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sharedStrings(xml: string | undefined): string[] {
  if (xml === undefined) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1] ?? ''));
}

function firstSheetPath(files: Record<string, Uint8Array>): string {
  const workbook = files['xl/workbook.xml'];
  const rels = files['xl/_rels/workbook.xml.rels'];
  if (workbook !== undefined && rels !== undefined) {
    const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(strFromU8(workbook))?.[1];
    if (rid !== undefined) {
      for (const rel of strFromU8(rels).matchAll(/<Relationship\b[^>]*>/g)) {
        const tag = rel[0];
        if (new RegExp(`\\bId="${rid}"`).test(tag)) {
          const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
          if (target !== undefined) return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
        }
      }
    }
  }
  const fallback = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if (fallback === undefined) throw new DataError('parse', 'El .xlsx no contiene ninguna hoja');
  return fallback;
}

/** Lee la primera hoja de un .xlsx como matriz de celdas (índice de fila/columna desde 0). */
export function readXlsx(bytes: Uint8Array): SheetRows {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (file) => file.name.startsWith('xl/') && file.name.endsWith('.xml') || file.name.endsWith('.rels') });
  } catch (error) {
    throw new DataError('parse', 'El archivo no es un .xlsx válido', { cause: error });
  }
  const sheetFile = files[firstSheetPath(files)];
  if (sheetFile === undefined) throw new DataError('parse', 'No se encontró la hoja principal del .xlsx');
  const strings = sharedStrings(files['xl/sharedStrings.xml'] === undefined ? undefined : strFromU8(files['xl/sharedStrings.xml']));
  const sheet = strFromU8(sheetFile);

  const rows: (SheetCell | undefined)[][] = [];
  for (const cell of sheet.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = cell[1] ?? '';
    const body = cell[2] ?? '';
    const ref = /\br="([A-Z]+)(\d+)"/.exec(attrs);
    if (ref?.[1] === undefined || ref[2] === undefined) continue;
    const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
    const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
    let value: SheetCell | undefined;
    if (type === 's' && raw !== undefined) {
      const text = strings[Number(raw)];
      if (text !== undefined) value = { kind: 'text', value: text };
    } else if (type === 'inlineStr') {
      value = { kind: 'text', value: textOf(body) };
    } else if (type === 'str' && raw !== undefined) {
      value = { kind: 'text', value: decodeEntities(raw) };
    } else if (type === 'n' && raw !== undefined && raw.trim() !== '') {
      const n = Number(raw);
      if (Number.isFinite(n)) value = { kind: 'number', value: n };
    }
    if (value === undefined) continue;
    const r = Number(ref[2]) - 1;
    const c = columnIndex(ref[1]);
    const row = (rows[r] ??= []);
    row[c] = value;
  }
  return Array.from(rows, (row) => row);
}
