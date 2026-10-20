import { describe, expect, it, vi } from 'vitest';

import { setBusy, isBusy, subscribeBusy } from './busy.ts';
import { createUpdater, fetchLatestBuildId } from './updater.ts';

const json = (body: unknown, ok = true): typeof fetch => (() => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response));

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

function make(latest: unknown, opts: { busy?: () => boolean; reload?: () => void; now?: () => number } = {}) {
  const reload = opts.reload ?? vi.fn();
  const updater = createUpdater({
    currentId: 'v1',
    baseUrl: '/',
    isBusy: opts.busy ?? (() => false),
    subscribeBusy,
    reload,
    fetchFn: json(latest),
    storage: memoryStorage(),
    ...(opts.now === undefined ? {} : { now: opts.now }),
  });
  return { updater, reload };
}

describe('actualización automática', () => {
  it('lee el identificador de version.json y tolera errores y respuestas raras', async () => {
    expect(await fetchLatestBuildId('/', json({ id: 'abc' }))).toBe('abc');
    expect(await fetchLatestBuildId('/', json({ id: 5 }))).toBeNull();
    expect(await fetchLatestBuildId('/', json({}, false))).toBeNull();
    expect(await fetchLatestBuildId('/', (() => Promise.reject(new Error('sin red'))))).toBeNull();
  });

  it('con la misma versión no recarga', async () => {
    const { updater, reload } = make({ id: 'v1' });
    await updater.check();
    expect(reload).not.toHaveBeenCalled();
    expect(updater.pending()).toBe(false);
  });

  it('con una versión nueva recarga una vez', async () => {
    const { updater, reload } = make({ id: 'v2' });
    await updater.check();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('si hay una exportación en curso espera a que termine y entonces recarga', async () => {
    setBusy('t', true);
    const { updater, reload } = make({ id: 'v2' }, { busy: isBusy });
    await updater.check();
    expect(reload).not.toHaveBeenCalled();
    expect(updater.pending()).toBe(true);
    setBusy('t', false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('no entra en bucle si el servidor sigue sirviendo la versión vieja', async () => {
    let t = 1_000;
    const { updater, reload } = make({ id: 'v2' }, { now: () => t });
    await updater.check();
    await updater.check();
    expect(reload).toHaveBeenCalledTimes(1);
    t += 3 * 60_000; // pasado el margen, vuelve a intentarlo
    await updater.check();
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
