import { describe, expect, it } from 'vitest';

import { CSV_EXAMPLE, parseCount, parseStatsCsv, statsToCsv } from './csv.ts';
import { mergePublications, parseDateLoose, publicationId, rankPublications, timelineOf, totalsOf, toPublications, urlProblem, type Publication } from './model.ts';

const pub = (over: Partial<Publication> & { id: string }): Publication => ({
  platform: 'tiktok',
  url: '',
  title: 'Vídeo de prueba',
  publishedAt: '2030-01-10',
  videoId: null,
  measurements: [],
  ...over,
});
const m = (date: string, views: number, likes = 0) => ({ date, views, likes, comments: 0, shares: 0, saves: 0, reach: null });

describe('modelo de estadísticas', () => {
  it('totales = suma de la última medición de cada publicación', () => {
    const a = pub({ id: 'a', measurements: [m('2030-01-11', 100, 10), m('2030-01-14', 400, 30)] });
    const b = pub({ id: 'b', platform: 'instagram', measurements: [m('2030-01-12', 50, 5)] });
    const t = totalsOf([a, b, pub({ id: 'c' })]);
    expect(t).toMatchObject({ views: 450, likes: 35, publications: 2 });
    expect(t.engagement).toBeCloseTo(35 / 450);
  });

  it('sin vistas no hay tasa de interacción', () => {
    expect(totalsOf([]).engagement).toBeNull();
  });

  it('la evolución usa la última medición conocida de cada publicación en cada fecha', () => {
    const a = pub({ id: 'a', measurements: [m('2030-01-11', 100), m('2030-01-14', 400)] });
    const b = pub({ id: 'b', measurements: [m('2030-01-12', 50)] });
    expect(timelineOf([a, b]).map((p) => [p.date, p.views])).toEqual([
      ['2030-01-11', 100],
      ['2030-01-12', 150],
      ['2030-01-14', 450],
    ]);
  });

  it('el ranking ordena por vistas, likes o interacción', () => {
    const a = pub({ id: 'a', title: 'A', measurements: [m('2030-01-11', 100, 50)] });
    const b = pub({ id: 'b', title: 'B', measurements: [m('2030-01-11', 500, 10)] });
    expect(rankPublications([a, b], 'views').map((p) => p.id)).toEqual(['b', 'a']);
    expect(rankPublications([a, b], 'likes').map((p) => p.id)).toEqual(['a', 'b']);
    expect(rankPublications([a, b], 'engagement').map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('fusionar por id une las mediciones por fecha y la entrante gana', () => {
    const a = pub({ id: 'a', measurements: [m('2030-01-11', 100)] });
    const inc = pub({ id: 'a', measurements: [m('2030-01-11', 120), m('2030-01-12', 200)] });
    const [merged] = mergePublications([a], [inc]);
    expect(merged?.measurements.map((x) => x.views)).toEqual([120, 200]);
  });

  it('valida lo guardado: descarta basura y recalcula el id', () => {
    const list = toPublications([{ platform: 'tiktok', url: 'https://www.tiktok.com/@x/video/1/', title: ' Hola   mundo ', publishedAt: '2030-02-01', measurements: [{ date: '2030-02-02', views: 5, likes: 1, comments: 0, shares: 0, saves: 0 }, { date: 'mal' }] }, { platform: 'otra' }, 7]);
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe('Hola mundo');
    expect(list[0]?.measurements).toHaveLength(1);
    expect(list[0]?.id).toBe(publicationId('tiktok', 'https://www.tiktok.com/@x/video/1', 'Hola mundo', '2030-02-01'));
  });

  it('comprueba que el enlace corresponde a la plataforma', () => {
    expect(urlProblem('tiktok', 'https://www.tiktok.com/@x/video/1')).toBeNull();
    expect(urlProblem('tiktok', 'https://www.instagram.com/reel/abc/')).toMatch(/TikTok/);
    expect(urlProblem('instagram', 'no es url')).toMatch(/URL/);
    expect(urlProblem('instagram', '')).toBeNull();
  });

  it('entiende fechas ISO y DD/MM/AAAA y rechaza las imposibles', () => {
    expect(parseDateLoose('2030-03-05')).toBe('2030-03-05');
    expect(parseDateLoose('5/3/2030')).toBe('2030-03-05');
    expect(parseDateLoose('31/02/2030')).toBeNull();
  });
});

describe('CSV de estadísticas', () => {
  it('lee el ejemplo del propio formato y agrupa las filas por publicación', () => {
    const r = parseStatsCsv(CSV_EXAMPLE);
    expect(r.issues).toEqual([]);
    expect(r.rows).toBe(2);
    expect(r.publications).toHaveLength(1);
    expect(r.publications[0]?.measurements.map((x) => x.views)).toEqual([1200, 5400]);
  });

  it('admite punto y coma, comillas, BOM y cabeceras en inglés', () => {
    const csv = '﻿platform;link;title;publishedAt;date;views;likes;comments;shares;saves\ninstagram;https://www.instagram.com/reel/abc/;"Con; punto y coma";10/01/2030;11/01/2030;"1.234";56;;;\n';
    const r = parseStatsCsv(csv);
    expect(r.issues).toEqual([]);
    expect(r.publications[0]).toMatchObject({ platform: 'instagram', title: 'Con; punto y coma', publishedAt: '2030-01-10' });
    expect(r.publications[0]?.measurements[0]).toMatchObject({ date: '2030-01-11', views: 1234, likes: 56, comments: 0 });
  });

  it('informa de las filas con error sin perder las buenas', () => {
    const csv = ['plataforma,url,titulo,publicado,fecha_medicion,vistas', 'tiktok,,Bien,2030-01-01,2030-01-02,10', 'youtube,,Mal,2030-01-01,2030-01-02,10', 'tiktok,,Fecha,2030-01-01,ayer,10', 'tiktok,,Num,2030-01-01,2030-01-02,diez'].join('\n');
    const r = parseStatsCsv(csv);
    expect(r.rows).toBe(1);
    expect(r.issues.map((i) => i.line)).toEqual([3, 4, 5]);
  });

  it('exige las columnas obligatorias', () => {
    const r = parseStatsCsv('url,titulo\nx,y');
    expect(r.rows).toBe(0);
    expect(r.issues[0]?.message).toMatch(/Faltan columnas/);
    expect(parseStatsCsv('').issues[0]?.message).toMatch(/vacío/);
  });

  it('exportar y volver a importar da los mismos datos', () => {
    const original = parseStatsCsv(CSV_EXAMPLE).publications;
    const again = parseStatsCsv(statsToCsv(original));
    expect(again.issues).toEqual([]);
    expect(again.publications).toEqual(original);
  });

  it('parseCount rechaza negativos, decimales y texto', () => {
    expect(parseCount('1.234')).toBe(1234);
    expect(parseCount('-5')).toBeNull();
    expect(parseCount('3,5')).toBeNull();
    expect(parseCount('abc')).toBeNull();
    expect(parseCount('')).toBeNull();
  });
});
