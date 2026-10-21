import {
  MAX_COUNT,
  MAX_PUBLICATIONS,
  MAX_TITLE,
  isIsoDate,
  latest,
  mergePublications,
  parseDateLoose,
  platformLabel,
  publicationId,
  sortMeasurements,
  urlProblem,
  type Measurement,
  type Platform,
  type Publication,
} from './model.ts';

/** Formato propio, una fila por MEDICIÓN. Varias filas con el mismo enlace forman la evolución de una publicación. */
export const CSV_HEADER = ['plataforma', 'url', 'titulo', 'publicado', 'fecha_medicion', 'vistas', 'likes', 'comentarios', 'compartidos', 'guardados', 'alcance'] as const;

export const CSV_EXAMPLE = [
  CSV_HEADER.join(','),
  'tiktok,https://www.tiktok.com/@ejemplo/video/1234567890,"Ejemplo: Equipo A vs Equipo B",2030-01-10,2030-01-11,1200,85,6,9,14,',
  'tiktok,https://www.tiktok.com/@ejemplo/video/1234567890,"Ejemplo: Equipo A vs Equipo B",2030-01-10,2030-01-14,5400,310,22,41,60,',
].join('\n');

export interface CsvIssue {
  /** Número de línea del archivo (1 = cabecera). */
  readonly line: number;
  readonly message: string;
}

export interface CsvResult {
  readonly publications: Publication[];
  /** Filas de datos leídas correctamente. */
  readonly rows: number;
  readonly issues: CsvIssue[];
}

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const ALIASES: Readonly<Record<string, readonly string[]>> = {
  platform: ['plataforma', 'platform', 'red', 'redsocial'],
  url: ['url', 'enlace', 'link', 'sharelink', 'videolink', 'permalink'],
  title: ['titulo', 'title', 'descripcion', 'description', 'caption', 'videotitle', 'nombre'],
  published: ['publicado', 'fechapublicacion', 'publicadoel', 'posttime', 'postdate', 'publishdate', 'publishedat', 'createtime'],
  date: ['fechamedicion', 'fecha', 'medicion', 'date', 'measuredat', 'fechadatos'],
  views: ['vistas', 'views', 'reproducciones', 'plays', 'videoviews', 'visualizaciones'],
  likes: ['likes', 'megusta', 'like'],
  comments: ['comentarios', 'comments', 'comment'],
  shares: ['compartidos', 'shares', 'share', 'compartir', 'vecescompartido'],
  saves: ['guardados', 'saves', 'saved', 'guardar', 'favoritos', 'favorites'],
  reach: ['alcance', 'reach', 'cuentasalcanzadas', 'accountsreached'],
};

/** Divide el texto en filas y celdas (admite comillas, comillas escapadas y saltos de línea dentro de celdas). */
export function parseCsvRows(text: string, delimiter: string): { line: number; cells: string[] }[] {
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const endCell = (): void => {
    cells.push(cell);
    cell = '';
  };
  const endRow = (): void => {
    endCell();
    if (cells.some((c) => c.trim() !== '')) rows.push({ line: rowLine, cells });
    cells = [];
    rowLine = line + 1;
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) endCell();
    else if (ch === '\n') {
      endRow();
      line += 1;
      rowLine = line;
    } else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || cells.length > 0) endRow();
  return rows;
}

function detectDelimiter(firstLine: string): string {
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    const n = firstLine.split(d).length;
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

function toPlatform(raw: string): Platform | null {
  const f = fold(raw);
  if (f === 'tiktok') return 'tiktok';
  if (f === 'instagram' || f === 'ig' || f === 'insta' || f === 'reel' || f === 'reels') return 'instagram';
  return null;
}

/** Entero ≥ 0. Admite «1.234», «1 234», «1,234» como separador de miles. `null` si no es un número válido. */
export function parseCount(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, '');
  if (t === '') return null;
  const clean = /^\d{1,3}([.,]\d{3})+$/.test(t) ? t.replace(/[.,]/g, '') : t;
  if (!/^\d+$/.test(clean)) return null;
  const n = Number(clean);
  return Number.isSafeInteger(n) && n <= MAX_COUNT ? n : null;
}

export function parseStatsCsv(input: string): CsvResult {
  const text = input.replace(/^\uFEFF/, '');
  const firstLine = text.split('\n', 1)[0] ?? '';
  const rows = parseCsvRows(text, detectDelimiter(firstLine));
  const issues: CsvIssue[] = [];
  const header = rows[0];
  if (header === undefined) return { publications: [], rows: 0, issues: [{ line: 1, message: 'El archivo está vacío.' }] };

  const col = new Map<string, number>();
  header.cells.forEach((name, i) => {
    const f = fold(name);
    for (const [key, names] of Object.entries(ALIASES)) if (!col.has(key) && names.map(fold).includes(f)) col.set(key, i);
  });
  const missing = (['platform', 'date', 'views'] as const).filter((k) => !col.has(k));
  if (missing.length > 0) {
    const names: Record<string, string> = { platform: 'plataforma', date: 'fecha_medicion', views: 'vistas' };
    return { publications: [], rows: 0, issues: [{ line: 1, message: `Faltan columnas obligatorias: ${missing.map((k) => names[k] ?? k).join(', ')}. Cabecera esperada: ${CSV_HEADER.join(', ')}.` }] };
  }
  if (!col.has('url') && !col.has('title')) {
    return { publications: [], rows: 0, issues: [{ line: 1, message: 'Hace falta la columna «url» o la columna «titulo» para identificar cada publicación.' }] };
  }

  const cell = (cells: readonly string[], key: string): string => {
    const i = col.get(key);
    return i === undefined ? '' : (cells[i] ?? '').trim();
  };

  const parsed: Publication[] = [];
  let ok = 0;
  for (const { line, cells } of rows.slice(1)) {
    const problem = (message: string): void => {
      issues.push({ line, message });
    };
    const platform = toPlatform(cell(cells, 'platform'));
    if (platform === null) {
      problem('La plataforma debe ser «tiktok» o «instagram».');
      continue;
    }
    const url = cell(cells, 'url');
    const bad = urlProblem(platform, url);
    if (bad !== null) {
      problem(bad);
      continue;
    }
    const date = parseDateLoose(cell(cells, 'date'));
    if (date === null) {
      problem('La fecha de medición no es válida (usa AAAA-MM-DD o DD/MM/AAAA).');
      continue;
    }
    const publishedRaw = cell(cells, 'published');
    const publishedAt = publishedRaw === '' ? date : parseDateLoose(publishedRaw);
    if (publishedAt === null) {
      problem('La fecha de publicación no es válida (usa AAAA-MM-DD o DD/MM/AAAA).');
      continue;
    }
    const titleRaw = cell(cells, 'title').replace(/\s+/g, ' ').slice(0, MAX_TITLE);
    const title = titleRaw !== '' ? titleRaw : url;
    if (title === '') {
      problem('Falta el título o el enlace de la publicación.');
      continue;
    }
    const nums: Record<string, number> = {};
    let numError: string | null = null;
    for (const key of ['views', 'likes', 'comments', 'shares', 'saves'] as const) {
      const raw = cell(cells, key);
      const n = raw === '' && key !== 'views' ? 0 : parseCount(raw);
      if (n === null) {
        numError = `«${key === 'views' ? 'vistas' : key}» debe ser un número entero ≥ 0.`;
        break;
      }
      nums[key] = n;
    }
    if (numError !== null) {
      problem(numError);
      continue;
    }
    const reachRaw = cell(cells, 'reach');
    const reach = reachRaw === '' ? null : parseCount(reachRaw);
    if (reachRaw !== '' && reach === null) {
      problem('«alcance» debe ser un número entero ≥ 0.');
      continue;
    }
    const m: Measurement = { date, views: nums['views'] ?? 0, likes: nums['likes'] ?? 0, comments: nums['comments'] ?? 0, shares: nums['shares'] ?? 0, saves: nums['saves'] ?? 0, reach };
    parsed.push({ id: publicationId(platform, url, title, publishedAt), platform, url, title, publishedAt, videoId: null, measurements: [m] });
    ok += 1;
  }
  const publications = mergePublications([], parsed);
  if (publications.length >= MAX_PUBLICATIONS) issues.push({ line: 0, message: `Se importan como máximo ${String(MAX_PUBLICATIONS)} publicaciones.` });
  return { publications, rows: ok, issues };
}

const quote = (s: string): string => (/[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Exporta todas las mediciones en el mismo formato que se importa (para copias de seguridad y para Excel). */
export function statsToCsv(pubs: readonly Publication[]): string {
  const lines: string[] = [CSV_HEADER.join(',')];
  for (const p of pubs) {
    for (const m of sortMeasurements(p.measurements)) {
      lines.push([p.platform, quote(p.url), quote(p.title), p.publishedAt, m.date, m.views, m.likes, m.comments, m.shares, m.saves, m.reach ?? ''].join(','));
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Texto corto para la lista: «TikTok · publicado 2030-01-10 · última medición 2030-01-14». */
export function describePublication(p: Publication): string {
  const l = latest(p);
  return `${platformLabel(p.platform)} · publicado ${p.publishedAt}${l === null ? ' · sin mediciones' : ` · última medición ${l.date}`}`;
}

export { isIsoDate };
