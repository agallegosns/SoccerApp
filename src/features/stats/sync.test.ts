import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publicationId, type Publication } from './model.ts';
import { getPublications, resetStatsForTests } from './store.ts';
import { cleanUrl, configProblem, getSyncState, parseSnapshot, resetSyncForTests, runSync, saveSyncConfig, snapshotToPublications } from './sync.ts';

const KEY = 'k'.repeat(30);
const IG = 'https://www.instagram.com/reel/AAA/';
const TT = 'https://www.tiktok.com/@yo/video/1';

const raw = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  updatedAt: '2026-10-21T10:00:00.000Z',
  sources: { instagram: { state: 'ok', message: null }, tiktok: { state: 'sin-autorizar', message: 'Falta autorizar' } },
  items: [
    { platform: 'instagram', url: IG, title: 'Athletic vs Valencia', publishedAt: '2026-10-19', views: 1200, likes: 40, comments: 3, shares: 4, saves: 7, reach: 900 },
    { platform: 'tiktok', url: TT, title: 'Final loca', publishedAt: '2026-10-18', views: 5400, likes: 310, comments: 22, shares: 41, saves: null, reach: null },
  ],
  ...over,
});

class MemoryStorage {
  private readonly data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  resetStatsForTests([]);
  resetSyncForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseSnapshot', () => {
  it('acepta una instantánea válida y descarta lo que no es de la plataforma o no tiene forma', () => {
    const snap = parseSnapshot(
      raw({
        items: [
          ...(raw()['items'] as unknown[]),
          { platform: 'instagram', url: 'https://evil.example/x', title: 'No es de Instagram', publishedAt: '2026-10-01', views: 1 },
          { platform: 'youtube', url: 'https://youtube.com/x', publishedAt: '2026-10-01' },
          { platform: 'tiktok', url: TT + '2', title: 'sin fecha', publishedAt: 'ayer' },
          'basura',
        ],
      }),
    );
    expect(snap?.items.map((i) => i.url)).toEqual([IG, TT]);
    expect(snap?.sources.tiktok).toEqual({ state: 'sin-autorizar', message: 'Falta autorizar' });
  });

  it('rechaza versiones y formatos desconocidos', () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot(raw({ version: 2 }))).toBeNull();
    expect(parseSnapshot(raw({ updatedAt: 'nunca' }))).toBeNull();
    expect(parseSnapshot(raw({ items: 'x' }))).toBeNull();
  });

  it('los contadores inválidos pasan a null en vez de a 0', () => {
    const snap = parseSnapshot(raw({ items: [{ platform: 'tiktok', url: TT, title: 'x', publishedAt: '2026-10-18', views: -5, likes: 1.5, comments: '3', shares: null, saves: 2, reach: undefined }] }));
    expect(snap?.items[0]).toMatchObject({ views: null, likes: null, comments: null, shares: null, saves: 2, reach: null });
  });
});

describe('snapshotToPublications', () => {
  it('crea una medición con la fecha de la recogida y conserva lo que la API no da', () => {
    const snap = parseSnapshot(raw());
    if (snap === null) throw new Error('instantánea inválida');
    const manual: Publication = {
      id: publicationId('tiktok', TT, 'Mi título', '2026-10-18'),
      platform: 'tiktok',
      url: TT,
      title: 'Mi título',
      publishedAt: '2026-10-18',
      videoId: 'v1',
      measurements: [{ date: '2026-10-19', views: 100, likes: 5, comments: 1, shares: 1, saves: 9, reach: null }],
    };
    const out = snapshotToPublications(snap, [manual]);
    const tiktok = out.find((p) => p.platform === 'tiktok');
    expect(tiktok?.id).toBe(manual.id); // mismo enlace → misma publicación, no un duplicado
    expect(tiktok?.title).toBe('Mi título'); // no pisa el título que escribió el usuario
    expect(tiktok?.measurements[0]).toMatchObject({ views: 5400, saves: 9 }); // «guardados» no los da TikTok: se conserva el 9
    const ig = out.find((p) => p.platform === 'instagram');
    expect(ig?.measurements[0]).toMatchObject({ views: 1200, saves: 7, reach: 900 });
    expect(ig?.measurements[0]?.date).toMatch(/^2026-10-2[01]$/);
  });
});

describe('configuración', () => {
  it('valida la dirección y la clave', () => {
    expect(configProblem('no es url', KEY)).toContain('URL válida');
    expect(configProblem('http://stats.example.com', KEY)).toContain('https://');
    expect(configProblem('https://stats.example.workers.dev', 'corta')).toContain('24 caracteres');
    expect(configProblem('https://stats.example.workers.dev', KEY)).toBeNull();
    expect(configProblem('http://localhost:8787', KEY)).toBeNull();
    expect(cleanUrl(' https://a.dev/// ')).toBe('https://a.dev');
  });
});

describe('runSync', () => {
  const connect = (): void => {
    saveSyncConfig({ url: 'https://stats.example.workers.dev/', key: KEY });
  };
  const respond = (status: number, body: unknown) => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

  it('sin conexión configurada no llama a nadie', async () => {
    const fetchFn = respond(200, raw());
    await runSync(fetchFn);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(getSyncState().status).toBe('off');
  });

  it('pide /stats con la clave, guarda las publicaciones y deja el estado', async () => {
    connect();
    const fetchFn = respond(200, raw());
    await runSync(fetchFn, () => 123);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://stats.example.workers.dev/stats');
    expect((fetchFn.mock.calls[0]?.[1]?.headers as Record<string, string>)['authorization']).toBe(`Bearer ${KEY}`);
    expect(getPublications()).toHaveLength(2);
    expect(getSyncState()).toMatchObject({ status: 'ok', checkedAt: 123, snapshotAt: '2026-10-21T10:00:00.000Z', changed: 2 });
    expect(getSyncState().sources?.tiktok.state).toBe('sin-autorizar');

    // Una segunda recogida el mismo día actualiza, no duplica.
    await runSync(fetchFn);
    expect(getPublications()).toHaveLength(2);
    expect(getPublications()[0]?.measurements).toHaveLength(1);
  });

  it('explica cada fallo en español y no toca los datos', async () => {
    connect();
    await runSync(respond(401, {}));
    expect(getSyncState()).toMatchObject({ status: 'error' });
    expect(getSyncState().message).toContain('rechazó la clave');
    await runSync(respond(404, {}));
    expect(getSyncState().message).toContain('todavía no tiene datos');
    await runSync(respond(500, {}));
    expect(getSyncState().message).toContain('HTTP 500');
    await runSync(respond(200, { otra: 'cosa' }));
    expect(getSyncState().message).toContain('formato esperado');
    await runSync(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(getSyncState().message).toContain('No se pudo contactar');
    expect(getPublications()).toHaveLength(0);
  });
});
