import { describe, expect, it } from 'vitest';

import { collect, handleRequest, maxItems, parseStoredSnapshot, type Env, type KV, type Snapshot } from './stats-worker.ts';

class MemoryKV implements KV {
  readonly data = new Map<string, string>();
  get(key: string): Promise<string | null> {
    return Promise.resolve(this.data.get(key) ?? null);
  }
  put(key: string, value: string): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
  delete(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
}

const NOW = Date.parse('2026-10-21T10:00:00Z');
const KEY = 'k'.repeat(32);
const bodyText = (init?: RequestInit): string => (typeof init?.body === 'string' ? init.body : '');
const reply = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

interface Call {
  readonly url: string;
  readonly init?: RequestInit;
}

/** Servidor falso de Instagram y TikTok: responde según la URL y apunta las llamadas. */
function fakeApis(options: { igFail?: boolean; ttPages?: number } = {}) {
  const calls: Call[] = [];
  const fetchFn = (input: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url: input, ...(init === undefined ? {} : { init }) });
    if (input.startsWith('https://graph.instagram.com/refresh_access_token')) return Promise.resolve(reply({ access_token: 'IG-NUEVO', expires_in: 5184000 }));
    if (input.includes('graph.instagram.com') && input.includes('/me/media')) {
      if (options.igFail === true) return Promise.resolve(reply({ error: { message: 'Token caducado' } }, 400));
      return Promise.resolve(
        reply({
          data: [
            { id: '111', caption: 'Athletic vs Valencia\n(simulación)', permalink: 'https://www.instagram.com/reel/AAA/', timestamp: '2026-10-19T18:00:00+0000', like_count: 40, comments_count: 3 },
            { id: '222', permalink: 'https://www.instagram.com/reel/BBB/', timestamp: '2026-10-20T09:00:00+0000', like_count: 5, comments_count: 0 },
          ],
        }),
      );
    }
    if (input.includes('/111/insights')) {
      return Promise.resolve(
        reply({ data: [{ name: 'views', values: [{ value: 1200 }] }, { name: 'reach', values: [{ value: 900 }] }, { name: 'saved', values: [{ value: 7 }] }, { name: 'shares', values: [{ value: 4 }] }] }),
      );
    }
    if (input.includes('/222/insights')) return Promise.resolve(reply({ error: { message: 'Insights no disponibles' } }, 400));
    if (input === 'https://open.tiktokapis.com/v2/oauth/token/') return Promise.resolve(reply({ access_token: 'TT-ACCESS-2', refresh_token: 'TT-REFRESH-2', expires_in: 86400, refresh_expires_in: 31536000 }));
    if (input.startsWith('https://open.tiktokapis.com/v2/video/list/')) {
      const sent = JSON.parse(bodyText(init) || '{}') as { cursor?: number };
      const first = sent.cursor === undefined;
      const videos = first
        ? [{ id: 't1', title: '', video_description: 'Final loca', create_time: Date.parse('2026-10-18T12:00:00Z') / 1000, share_url: 'https://www.tiktok.com/@yo/video/1', view_count: 5400, like_count: 310, comment_count: 22, share_count: 41 }]
        : [{ id: 't2', title: 'Segundo', create_time: Date.parse('2026-10-17T12:00:00Z') / 1000, share_url: 'https://www.tiktok.com/@yo/video/2', view_count: 10, like_count: 1, comment_count: 0, share_count: 0 }];
      return Promise.resolve(reply({ data: { videos, cursor: 123, has_more: first && (options.ttPages ?? 1) > 1 }, error: { code: 'ok' } }));
    }
    return Promise.resolve(reply({ error: { message: `URL inesperada ${input}` } }, 500));
  };
  return { calls, fetchFn };
}

function makeEnv(extra: Partial<Env> = {}): { env: Env; kv: MemoryKV } {
  const kv = new MemoryKV();
  return { kv, env: { STATS: kv, STATS_KEY: KEY, IG_TOKEN: 'IG-INICIAL', TIKTOK_CLIENT_KEY: 'ck', TIKTOK_CLIENT_SECRET: 'cs', ...extra } };
}

const authorizedTikTok = (kv: MemoryKV, accessExpiresAt = NOW + 3_600_000): void => {
  kv.data.set('tt_auth', JSON.stringify({ access: 'TT-ACCESS', accessExpiresAt, refresh: 'TT-REFRESH', refreshExpiresAt: NOW + 86_400_000 * 100 }));
};

describe('recogida de estadísticas (Worker)', () => {
  it('recoge Instagram y TikTok y no inventa los datos que la API no da', async () => {
    const { env, kv } = makeEnv();
    authorizedTikTok(kv);
    const { fetchFn } = fakeApis();
    const snap = await collect(env, fetchFn, NOW);

    expect(snap.sources.instagram.state).toBe('ok');
    expect(snap.sources.tiktok.state).toBe('ok');
    const reel = snap.items.find((i) => i.url.endsWith('/AAA/'));
    expect(reel).toMatchObject({ platform: 'instagram', title: 'Athletic vs Valencia (simulación)', publishedAt: '2026-10-19', views: 1200, likes: 40, comments: 3, shares: 4, saves: 7, reach: 900 });
    // Insights no disponibles → vistas/guardados/compartidos/alcance quedan en null, nunca en 0.
    expect(snap.items.find((i) => i.url.endsWith('/BBB/'))).toMatchObject({ views: null, shares: null, saves: null, reach: null, likes: 5, comments: 0, title: 'Publicación de Instagram' });
    const tiktok = snap.items.find((i) => i.platform === 'tiktok');
    expect(tiktok).toMatchObject({ title: 'Final loca', publishedAt: '2026-10-18', views: 5400, likes: 310, comments: 22, shares: 41, saves: null, reach: null });
    expect(parseStoredSnapshot(kv.data.get('snapshot') ?? null)?.updatedAt).toBe('2026-10-21T10:00:00.000Z');
  });

  it('renueva el token de Instagram cada semana y guarda el nuevo', async () => {
    const { env, kv } = makeEnv();
    authorizedTikTok(kv);
    const { fetchFn, calls } = fakeApis();
    await collect(env, fetchFn, NOW);
    expect(kv.data.get('ig_token')).toBe('IG-NUEVO');
    expect(calls.some((c) => c.url.includes('refresh_access_token'))).toBe(true);
    expect(calls.find((c) => c.url.includes('/me/media'))?.url).toContain('access_token=IG-NUEVO');

    // Un día después no vuelve a renovarlo.
    const second = fakeApis();
    await collect(env, second.fetchFn, NOW + 86_400_000);
    expect(second.calls.some((c) => c.url.includes('refresh_access_token'))).toBe(false);
  });

  it('si una plataforma falla conserva lo último bueno de esa plataforma y lo indica', async () => {
    const { env, kv } = makeEnv();
    authorizedTikTok(kv);
    const good = await collect(env, fakeApis().fetchFn, NOW);
    const bad = await collect(env, fakeApis({ igFail: true }).fetchFn, NOW + 1_800_000);
    expect(bad.sources.instagram.state).toBe('error');
    expect(bad.sources.instagram.message).toContain('Token caducado');
    expect(bad.sources.tiktok.state).toBe('ok');
    expect(bad.items.filter((i) => i.platform === 'instagram')).toEqual(good.items.filter((i) => i.platform === 'instagram'));
  });

  it('distingue «sin configurar» de «sin autorizar»', async () => {
    const { env } = makeEnv({ IG_TOKEN: '', TIKTOK_CLIENT_KEY: undefined });
    const snap = await collect(env, fakeApis().fetchFn, NOW);
    expect(snap.sources.instagram.state).toBe('sin-configurar');
    expect(snap.sources.tiktok.state).toBe('sin-configurar');
    const { env: env2 } = makeEnv({ IG_TOKEN: '' });
    expect((await collect(env2, fakeApis().fetchFn, NOW)).sources.tiktok.state).toBe('sin-autorizar');
  });

  it('refresca el token de TikTok cuando va a caducar y guarda el refresh_token nuevo', async () => {
    const { env, kv } = makeEnv({ IG_TOKEN: '' });
    authorizedTikTok(kv, NOW + 60_000);
    const { fetchFn, calls } = fakeApis();
    await collect(env, fetchFn, NOW);
    const refresh = calls.find((c) => c.url === 'https://open.tiktokapis.com/v2/oauth/token/');
    expect(bodyText(refresh?.init)).toContain('grant_type=refresh_token');
    expect(bodyText(refresh?.init)).toContain('refresh_token=TT-REFRESH');
    expect(JSON.parse(kv.data.get('tt_auth') ?? '{}')).toMatchObject({ access: 'TT-ACCESS-2', refresh: 'TT-REFRESH-2' });
    const list = calls.find((c) => c.url.startsWith('https://open.tiktokapis.com/v2/video/list/'));
    expect((list?.init?.headers as Record<string, string>)['authorization']).toBe('Bearer TT-ACCESS-2');
  });

  it('pagina la lista de TikTok y respeta el máximo de publicaciones', async () => {
    const { env, kv } = makeEnv({ IG_TOKEN: '' });
    authorizedTikTok(kv);
    const snap = await collect(env, fakeApis({ ttPages: 2 }).fetchFn, NOW);
    expect(snap.items.filter((i) => i.platform === 'tiktok').map((i) => i.title)).toEqual(['Final loca', 'Segundo']);
    expect(maxItems({})).toBe(20);
    expect(maxItems({ MAX_ITEMS: '5' })).toBe(5);
    expect(maxItems({ MAX_ITEMS: '999' })).toBe(25);
    expect(maxItems({ MAX_ITEMS: 'x' })).toBe(20);
  });
});

describe('API HTTP del Worker', () => {
  const get = (path: string, env: Env, headers: Record<string, string> = {}, method = 'GET'): Promise<Response> =>
    handleRequest(new Request(`https://stats.example.workers.dev${path}`, { method, headers }), env, fakeApis().fetchFn, NOW);

  it('exige la clave y no acepta claves cortas', async () => {
    const { env, kv } = makeEnv();
    kv.data.set('snapshot', JSON.stringify({ version: 1, updatedAt: new Date(NOW).toISOString(), sources: {}, items: [] }));
    expect((await get('/stats', env)).status).toBe(401);
    expect((await get('/stats', env, { authorization: 'Bearer otra' })).status).toBe(401);
    expect((await get('/stats', env, { authorization: `Bearer ${KEY}` })).status).toBe(200);
    expect((await get('/stats', { ...env, STATS_KEY: 'corta' }, { authorization: 'Bearer corta' })).status).toBe(401);
  });

  it('devuelve 404 claro si aún no hay datos y CORS con el origen permitido', async () => {
    const { env } = makeEnv({ ALLOWED_ORIGIN: 'https://agallegosns.github.io' });
    const res = await get('/stats', env, { authorization: `Bearer ${KEY}` });
    expect(res.status).toBe(404);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://agallegosns.github.io');
    expect((await get('/stats', env, {}, 'OPTIONS')).status).toBe(204);
  });

  it('POST /refresh recoge al momento y limita a una vez por minuto', async () => {
    const { env, kv } = makeEnv();
    authorizedTikTok(kv);
    const res = await get('/refresh', env, { authorization: `Bearer ${KEY}` }, 'POST');
    const snap = (await res.json()) as Snapshot;
    expect(snap.items.length).toBeGreaterThan(0);
    kv.data.set('ig_token', 'MARCA'); // si volviera a recoger, lo habría renovado
    await get('/refresh', env, { authorization: `Bearer ${KEY}` }, 'POST');
    expect(kv.data.get('ig_token')).toBe('MARCA');
    expect((await get('/refresh', env, {}, 'POST')).status).toBe(401);
  });

  it('autoriza TikTok: login con clave → callback con state válido guarda los tokens', async () => {
    const { env, kv } = makeEnv();
    expect((await get('/tiktok/login', env)).status).toBe(401);
    const login = await get(`/tiktok/login?key=${KEY}`, env);
    expect(login.status).toBe(302);
    const target = new URL(login.headers.get('location') ?? '');
    expect(target.origin + target.pathname).toBe('https://www.tiktok.com/v2/auth/authorize/');
    expect(target.searchParams.get('scope')).toBe('user.info.basic,video.list');
    expect(target.searchParams.get('redirect_uri')).toBe('https://stats.example.workers.dev/tiktok/callback');
    const state = target.searchParams.get('state') ?? '';
    expect(kv.data.has(`tt_state_${state}`)).toBe(true);

    expect((await get('/tiktok/callback?code=abc&state=falso', env)).status).toBe(400);
    const done = await get(`/tiktok/callback?code=abc&state=${state}`, env);
    expect(done.status).toBe(200);
    expect(JSON.parse(kv.data.get('tt_auth') ?? '{}')).toMatchObject({ access: 'TT-ACCESS-2', refresh: 'TT-REFRESH-2' });
    expect(kv.data.has(`tt_state_${state}`)).toBe(false); // el state sólo sirve una vez
  });
});
