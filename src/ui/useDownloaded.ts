import { useSyncExternalStore } from 'react';

import { getDownloaded, subscribeDownloaded } from '../data/downloaded.ts';

/** Ids de los partidos con algún vídeo ya descargado (se actualiza solo). */
export function useDownloaded(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeDownloaded, getDownloaded, getDownloaded);
}
