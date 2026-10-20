import { describe, expect, it, vi } from 'vitest';

import { getDownloaded, markDownloaded, resetDownloadedForTests, subscribeDownloaded } from './downloaded.ts';

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
});
