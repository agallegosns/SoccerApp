import { listKeys, readJson, removeKey, writeJson } from '../../data/cache.ts';
import { getDownloaded, replaceDownloaded } from '../../data/downloaded.ts';
import { isRecord } from '../../data/parsers.ts';
import { mergePublications, toPublications } from '../stats/model.ts';
import { getPublications, replacePublications } from '../stats/store.ts';
import { toVideoRecords } from '../videos/model.ts';
import { getPublished, replacePublished } from '../videos/published.ts';
import { getScheduled, LOCAL_DATETIME, replaceScheduled } from '../videos/scheduled.ts';
import { getVideos, replaceVideos } from '../videos/store.ts';
import type { Collection } from './engine.ts';

/** Las colecciones que se sincronizan entre dispositivos (los MP4 no: se regeneran idénticos desde su ficha). */
export const COLLECTION_NAMES = ['videos', 'published', 'scheduled', 'downloaded', 'stats', 'imported', 'crests'] as const;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const IMPORTED_KEY = 'imported-calendars';
const CREST_PREFIX = 'crest:';
const MAX_CREST_CHARS = 700_000;

const onlyStrings = (map: Record<string, unknown>, ok: (v: string) => boolean): Record<string, string> =>
  Object.fromEntries(Object.entries(map).filter((e): e is [string, string] => typeof e[1] === 'string' && ok(e[1])));

function importedList(): Record<string, unknown> {
  const list = readJson(IMPORTED_KEY, (v): v is unknown[] => Array.isArray(v)) ?? [];
  const out: Record<string, unknown> = {};
  for (const item of list) {
    if (isRecord(item) && isRecord(item['league']) && typeof item['league']['id'] === 'string' && Array.isArray(item['matches'])) out[item['league']['id']] = item;
  }
  return out;
}

export const videosCollection: Collection = {
  name: 'videos',
  read: () => Object.fromEntries(getVideos().map((v) => [v.id, v])),
  write: (next) => { replaceVideos(toVideoRecords(Object.values(next))); },
};

export const publishedCollection: Collection = {
  name: 'published',
  read: () => ({ ...getPublished() }),
  write: (next) => { replacePublished(onlyStrings(next, (d) => ISO_DAY.test(d))); },
};

export const scheduledCollection: Collection = {
  name: 'scheduled',
  read: () => ({ ...getScheduled() }),
  write: (next) => { replaceScheduled(onlyStrings(next, (d) => LOCAL_DATETIME.test(d))); },
};

export const downloadedCollection: Collection = {
  name: 'downloaded',
  read: () => Object.fromEntries([...getDownloaded()].map((id) => [id, true])),
  write: (next) => { replaceDownloaded(Object.keys(next)); },
};

export const statsCollection: Collection = {
  name: 'stats',
  read: () => Object.fromEntries(getPublications().map((p) => [p.id, p])),
  write: (next) => { replacePublications(toPublications(Object.values(next))); },
  // Si las dos copias añadieron mediciones, se unen (no gana una sola).
  merge: (local, remote) => mergePublications(toPublications([local]), toPublications([remote]))[0] ?? remote,
};

/** Calendarios importados desde un archivo: se escriben en el almacenamiento y se ven al recargar la app. */
export const importedCollection: Collection = {
  name: 'imported',
  read: importedList,
  write: (next) => {
    const valid = Object.values(next).filter((item) => isRecord(item) && isRecord(item['league']) && Array.isArray(item['matches']));
    if (valid.length === 0) removeKey(IMPORTED_KEY);
    else writeJson(IMPORTED_KEY, valid);
  },
};

/** Escudos subidos por el usuario (data URL PNG de 256 px). */
export const crestsCollection: Collection = {
  name: 'crests',
  read: () => {
    const out: Record<string, unknown> = {};
    for (const key of listKeys(CREST_PREFIX)) {
      const value = readJson(key, (v): v is string => typeof v === 'string');
      if (value !== null && value.startsWith('data:image/') && value.length <= MAX_CREST_CHARS) out[key.slice(CREST_PREFIX.length)] = value;
    }
    return out;
  },
  write: (next) => {
    const wanted = onlyStrings(next, (v) => v.startsWith('data:image/') && v.length <= MAX_CREST_CHARS);
    for (const key of listKeys(CREST_PREFIX)) if (!(key.slice(CREST_PREFIX.length) in wanted)) removeKey(key);
    for (const [slug, dataUrl] of Object.entries(wanted)) writeJson(`${CREST_PREFIX}${slug}`, dataUrl);
  },
};

export const ALL_COLLECTIONS: readonly Collection[] = [videosCollection, publishedCollection, scheduledCollection, downloadedCollection, statsCollection, importedCollection, crestsCollection];
