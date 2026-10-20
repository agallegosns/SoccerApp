import { describe, expect, it, vi } from 'vitest';

import { getDownloaded, markDownloaded, resetDownloadedForTests, subscribeDownloaded, toggleDownloaded, unmarkDownloaded } from './downloaded.ts';

describe('partidos descargados', () => {
  it('marca un partido, avisa a los suscriptores una sola vez y no duplica', () => {
    resetDownloadedForTests();
    const listener = vi.fn();
    const off = subscribeDownloaded(listener);
    markDownloaded('a');
    markDownloaded('a');
    markDownloaded('b');
    expect([...getDownloaded()].sort()).toEqual(['a', 'b']);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    markDownloaded('c');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('cada cambio crea un conjunto nuevo (necesario para useSyncExternalStore)', () => {
    resetDownloadedForTests();
    const before = getDownloaded();
    markDownloaded('x');
    expect(getDownloaded()).not.toBe(before);
  });

  it('se puede marcar y desmarcar a mano', () => {
    resetDownloadedForTests();
    const listener = vi.fn();
    const off = subscribeDownloaded(listener);
    toggleDownloaded('p');
    expect(getDownloaded().has('p')).toBe(true);
    toggleDownloaded('p');
    expect(getDownloaded().has('p')).toBe(false);
    unmarkDownloaded('p'); // ya no está: no avisa
    expect(listener).toHaveBeenCalledTimes(2);
    off();
  });
});
