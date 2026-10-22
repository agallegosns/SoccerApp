import { describe, expect, it } from 'vitest';

import { handleRequest, type Env, type KV } from '../../../cloudflare/stats-worker.ts';
import { EMPTY_META, type Meta } from './core.ts';
import { syncOnce, SyncError, type Collection } from './engine.ts';

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

const KEY = 'k'.repeat(32);
const URL_BASE = 'https://sync.example.workers.dev';

/** Servidor: el Worker real con un KV en memoria. `clock` es la hora del servidor. */
function makeServer(clock: { now: number }) {
  const kv = new MemoryKV();
  const env: Env = { STATS: kv, STATS_KEY: KEY };
  const fetchFn = (input: string, init?: RequestInit): Promise<Response> => handleRequest(new Request(input, init), env, () => Promise.reject(new Error('sin red externa')), clock.now);
  return { kv, fetchFn };
}

/** Dispositivo: colecciones en memoria + meta propia + reloj propio (desfasable). */
function makeDevice(server: ReturnType<typeof makeServer>, clock: { now: number }, offset = 0) {
  const data: Record<string, Record<string, unknown>> = { videos: {}, published: {}, stats: {} };
  let meta: Meta = EMPTY_META;
  const collections: Collection[] = Object.keys(data).map((name) => ({
    name,
    read: () => ({ ...data[name] }),
    write: (next) => {
      data[name] = { ...next };
    },
    ...(name === 'stats'
      ? { merge: (local: unknown, remote: unknown) => ({ ...(local as object), ...(remote as object), m: [...new Set([...((local as { m: number[] }).m), ...((remote as { m: number[] }).m)])].sort() }) }
      : {}),
  }));
  return {
    data,
    get meta() {
      return meta;
    },
    sync: () => syncOnce({ url: URL_BASE, key: KEY }, { collections, loadMeta: () => meta, saveMeta: (m) => { meta = m; }, fetchFn: server.fetchFn, now: () => clock.now + offset }),
  };
}

const tick = (clock: { now: number }): void => {
  clock.now += 1000;
};

describe('sincronización entre dos dispositivos (Worker real + KV en memoria)', () => {
  it('lo que se crea en el móvil aparece en el ordenador y viceversa', async () => {
    const clock = { now: Date.parse('2026-10-21T10:00:00Z') };
    const server = makeServer(clock);
    const phone = makeDevice(server, clock);
    const pc = makeDevice(server, clock);
    phone.data['videos'] = { a: { id: 'a', seed: 1 } };
    const first = await phone.sync();
    expect(first.sent).toBe(1);
    tick(clock);
    const r = await pc.sync();
    expect(r.received).toBe(1);
    expect(r.changed).toEqual(['videos']);
    expect(pc.data['videos']).toEqual({ a: { id: 'a', seed: 1 } });
    tick(clock);
    pc.data['videos'] = { ...pc.data['videos'], b: { id: 'b', seed: 2 } };
    pc.data['published'] = { a: '2026-10-21' };
    await pc.sync();
    tick(clock);
    await phone.sync();
    expect(Object.keys(phone.data['videos'] ?? {})).toEqual(['a', 'b']);
    expect(phone.data['published']).toEqual({ a: '2026-10-21' });
  });

  it('un borrado se propaga y no vuelve; si se vuelve a crear después, gana lo nuevo', async () => {
    const clock = { now: Date.parse('2026-10-21T10:00:00Z') };
    const server = makeServer(clock);
    const phone = makeDevice(server, clock);
    const pc = makeDevice(server, clock);
    phone.data['videos'] = { a: { id: 'a', seed: 1 }, b: { id: 'b', seed: 2 } };
    await phone.sync();
    tick(clock);
    await pc.sync();
    tick(clock);
    pc.data['videos'] = { b: { id: 'b', seed: 2 } };
    await pc.sync();
    tick(clock);
    await phone.sync();
    expect(Object.keys(phone.data['videos'] ?? {})).toEqual(['b']);
    // Otra vuelta: el borrado no resucita.
    tick(clock);
    await phone.sync();
    tick(clock);
    await pc.sync();
    expect(Object.keys(pc.data['videos'] ?? {})).toEqual(['b']);
    // Se vuelve a crear en el móvil.
    tick(clock);
    phone.data['videos'] = { a: { id: 'a', seed: 1 }, b: { id: 'b', seed: 2 } };
    await phone.sync();
    tick(clock);
    await pc.sync();
    expect(Object.keys(pc.data['videos'] ?? {})).toEqual(['b', 'a']);
  });

  it('si los dos cambian lo mismo, gana el cambio más reciente', async () => {
    const clock = { now: Date.parse('2026-10-21T10:00:00Z') };
    const server = makeServer(clock);
    const phone = makeDevice(server, clock);
    const pc = makeDevice(server, clock);
    phone.data['published'] = { a: '2026-10-20' };
    await phone.sync();
    tick(clock);
    await pc.sync();
    tick(clock);
    phone.data['published'] = { a: '2026-10-21' };
    await phone.sync();
    tick(clock);
    pc.data['published'] = { a: '2026-10-22' };
    await pc.sync(); // el del ordenador es más reciente
    tick(clock);
    await phone.sync();
    expect(phone.data['published']).toEqual({ a: '2026-10-22' });
    expect(pc.data['published']).toEqual({ a: '2026-10-22' });
  });

  it('un reloj atrasado no pisa un cambio más reciente de otro dispositivo (se corrige con la hora del servidor)', async () => {
    const clock = { now: Date.parse('2026-10-21T10:00:00Z') };
    const server = makeServer(clock);
    const phone = makeDevice(server, clock);
    const lagging = makeDevice(server, clock, -3_600_000); // una hora atrasado
    phone.data['published'] = { a: '2026-10-20' };
    await phone.sync();
    tick(clock);
    await lagging.sync(); // aprende su desfase
    tick(clock);
    phone.data['published'] = { a: '2026-10-21' };
    await phone.sync();
    tick(clock);
    lagging.data['published'] = { a: '2026-10-22' }; // cambio posterior, hecho con el reloj atrasado
    await lagging.sync();
    tick(clock);
    await phone.sync();
    expect(phone.data['published']).toEqual({ a: '2026-10-22' });
  });

  it('las mediciones de estadísticas de los dos dispositivos se unen en vez de perderse', async () => {
    const clock = { now: Date.parse('2026-10-21T10:00:00Z') };
    const server = makeServer(clock);
    const phone = makeDevice(server, clock);
    const pc = makeDevice(server, clock);
    phone.data['stats'] = { p: { id: 'p', m: [1] } };
    await phone.sync();
    tick(clock);
    await pc.sync();
    tick(clock);
    phone.data['stats'] = { p: { id: 'p', m: [1, 2] } };
    pc.data['stats'] = { p: { id: 'p', m: [1, 3] } };
    await phone.sync();
    tick(clock);
    await pc.sync(); // fusiona [1,2] con [1,3] y reenvía
    tick(clock);
    await pc.sync();
    tick(clock);
    await phone.sync();
    expect(phone.data['stats']).toEqual({ p: { id: 'p', m: [1, 2, 3] } });
    expect(pc.data['stats']).toEqual({ p: { id: 'p', m: [1, 2, 3] } });
  });

  it('sin cambios no escribe en KV y un dispositivo nuevo recibe todo', async () => {
    const clock = { now: Date.parse('2026-10-21T10:00:00Z') };
    const server = makeServer(clock);
    const phone = makeDevice(server, clock);
    phone.data['videos'] = { a: { id: 'a' } };
    await phone.sync();
    const stored = server.kv.data.get('sync_doc');
    tick(clock);
    const again = await phone.sync();
    expect(again.sent).toBe(0);
    expect(again.received).toBe(0);
    expect(server.kv.data.get('sync_doc')).toBe(stored);
    const fresh = makeDevice(server, clock);
    await fresh.sync();
    expect(fresh.data['videos']).toEqual({ a: { id: 'a' } });
  });

  it('errores claros: clave mala, Worker sin /sync y sin conexión', async () => {
    const clock = { now: 1_800_000_000_000 };
    const server = makeServer(clock);
    const device = makeDevice(server, clock);
    const run = (fetchFn: (i: string, init?: RequestInit) => Promise<Response>, key = KEY) =>
      syncOnce({ url: URL_BASE, key }, { collections: [], loadMeta: () => EMPTY_META, saveMeta: () => undefined, fetchFn });
    await expect(run(server.fetchFn, 'x'.repeat(32))).rejects.toMatchObject({ kind: 'auth' });
    await expect(run(() => Promise.resolve(new Response('{"error":"No encontrado"}', { status: 404 })))).rejects.toMatchObject({ kind: 'missing' });
    await expect(run(() => Promise.reject(new TypeError('Failed to fetch')))).rejects.toBeInstanceOf(SyncError);
    await expect(run(() => Promise.reject(new TypeError('Failed to fetch')))).rejects.toMatchObject({ kind: 'network' });
    expect(device.meta).toEqual(EMPTY_META);
  });
});
