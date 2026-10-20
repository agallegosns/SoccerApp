import { isBusy, subscribeBusy } from './busy.ts';
import { CHECK_EVERY_MS, createUpdater, type Updater } from './updater.ts';

let updater: Updater | null = null;

/** Arranca la actualización automática (una sola vez). En desarrollo no hace nada: no hay `version.json`. */
export function startAutoUpdate(): void {
  if (updater !== null || import.meta.env.DEV) return;
  let storage: Storage | null = null;
  try {
    storage = localStorage;
  } catch (error) {
    console.debug('localStorage no disponible', error);
  }
  const u = createUpdater({
    currentId: __BUILD_ID__,
    baseUrl: import.meta.env.BASE_URL,
    isBusy,
    subscribeBusy,
    reload: () => { location.reload(); },
    storage,
  });
  updater = u;
  const check = (): void => void u.check();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('online', check);
  window.setInterval(check, CHECK_EVERY_MS);
  check();
}

export const updatePending = {
  get: (): boolean => updater?.pending() ?? false,
  subscribe: (listener: () => void): (() => void) => updater?.subscribePending(listener) ?? (() => undefined),
};
