import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Match } from '../../data/types.ts';
import { DEFAULT_VIDEO_OPTIONS } from '../simulation/options.ts';
import { buildRecord, filterVideos, hashtag, toVideoRecord, toVideoRecords, videoId, type VideoParams, type VideoRecord } from './model.ts';
import { getVideos, removeVideo, resetVideosForTests, upsertVideo } from './store.ts';

const match: Match = {
  id: 'prueba-1',
  leagueId: 'es.1',
  competition: 'LaLiga 2030-31',
  round: 'Jornada 3',
  date: '2030-09-14',
  time: '21:00',
  timeKind: 'league-local',
  home: 'Real Sociedad',
  away: 'Club de Prueba',
  realScore: null,
};

const params = (over: Partial<VideoParams> = {}): VideoParams => ({
  match,
  seed: 7,
  style: 'arena',
  pace: 'fast',
  fixedScore: null,
  score: { home: 2, away: 1 },
  options: DEFAULT_VIDEO_OPTIONS,
  ...over,
});

const record = (over: Partial<VideoParams> = {}, now = 1_000): VideoRecord => buildRecord(params(over), { fileName: 'a.mp4', bytes: 1_000_000, durationSeconds: 26 }, now);

describe('fichas de vídeo', () => {
  it('el id depende de los parámetros del vídeo, no de cuándo se exportó', () => {
    expect(videoId(params())).toBe(videoId(params()));
    expect(record({}, 1).id).toBe(record({}, 999).id);
    expect(videoId(params({ seed: 8 }))).not.toBe(videoId(params()));
    expect(videoId(params({ pace: 'normal' }))).not.toBe(videoId(params()));
    expect(videoId(params({ fixedScore: { home: 1, away: 0 } }))).not.toBe(videoId(params()));
    expect(videoId(params({ options: { ...DEFAULT_VIDEO_OPTIONS, theme: 'neon' } }))).not.toBe(videoId(params()));
    expect(videoId(params())).toMatch(/^[0-9a-f]{16}$/);
  });

  it('una ficha guardada se lee igual y se descarta lo corrupto', () => {
    const r = record();
    expect(toVideoRecord(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(toVideoRecord({ ...r, seed: -1 })).toBeNull();
    expect(toVideoRecord({ ...r, style: 'otro' })).toBeNull();
    expect(toVideoRecord({ ...r, match: { ...match, date: 'ayer' } })).toBeNull();
    expect(toVideoRecord({ ...r, score: { home: 'x', away: 1 } })).toBeNull();
    expect(toVideoRecord({ ...r, fixedScore: 'mal' })).toBeNull();
    expect(toVideoRecord('texto')).toBeNull();
    // Opciones raras vuelven a los valores predeterminados, no rompen la ficha.
    expect(toVideoRecord({ ...r, options: { theme: 'inexistente' } })?.options.theme).toBe(DEFAULT_VIDEO_OPTIONS.theme);
  });

  it('una lista guardada se limpia: sin duplicados ni elementos inválidos', () => {
    const r = record();
    expect(toVideoRecords([r, r, 5, null, record({ seed: 9 })])).toHaveLength(2);
    expect(toVideoRecords('no es una lista')).toEqual([]);
  });

  it('los hashtags no llevan espacios, acentos ni signos', () => {
    expect(hashtag('Atlético de Madrid')).toBe('#AtleticoDeMadrid');
    expect(hashtag('---')).toBe('');
  });

  it('filtra por texto (sin acentos ni mayúsculas), competición y descarga', () => {
    const a = record();
    const b = record({ seed: 8, match: { ...match, id: 'prueba-2', competition: 'Premier League 2030-31', home: 'Atlético Prueba' } });
    const all = [a, b];
    const none = new Set<string>();
    expect(filterVideos(all, { text: 'atletico', competition: '', downloaded: 'all' }, none)).toEqual([b]);
    expect(filterVideos(all, { text: '', competition: 'LaLiga 2030-31', downloaded: 'all' }, none)).toEqual([a]);
    expect(filterVideos(all, { text: '8', competition: '', downloaded: 'all' }, none)).toEqual([b]);
    expect(filterVideos(all, { text: '', competition: '', downloaded: 'yes' }, new Set(['prueba-2']))).toEqual([b]);
    expect(filterVideos(all, { text: '', competition: '', downloaded: 'no' }, new Set(['prueba-2']))).toEqual([a]);
  });
});

describe('almacén de fichas', () => {
  beforeEach(() => {
    resetVideosForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined); // en pruebas no hay localStorage
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('volver a exportar el mismo vídeo actualiza la ficha y la sube al principio; quitar la elimina', () => {
    upsertVideo(record({ seed: 1 }, 10));
    upsertVideo(record({ seed: 2 }, 20));
    expect(getVideos().map((v) => v.seed)).toEqual([2, 1]);
    upsertVideo(buildRecord(params({ seed: 1 }), { fileName: 'a.mp4', bytes: 5, durationSeconds: 26 }, 30));
    expect(getVideos().map((v) => v.seed)).toEqual([1, 2]);
    expect(getVideos()[0]?.bytes).toBe(5);
    const id = getVideos()[0]?.id ?? '';
    removeVideo(id);
    expect(getVideos().map((v) => v.seed)).toEqual([2]);
    removeVideo('no-existe');
    expect(getVideos()).toHaveLength(1);
  });
});
