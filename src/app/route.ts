import { useMemo, useSyncExternalStore } from 'react';

/** Secciones de la aplicación. La ruta vive en el hash de la URL (`#/videos/ID`), así funciona igual en cualquier alojamiento y el botón «atrás» navega. */
export type Route =
  | { readonly view: 'calendar' }
  | { readonly view: 'videos'; readonly videoId: string | null }
  | { readonly view: 'stats' };

export function parseHash(hash: string): Route {
  const parts = hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter((p) => p !== '');
  if (parts[0] === 'videos') {
    const id = parts[1];
    return { view: 'videos', videoId: id === undefined ? null : safeDecode(id) };
  }
  if (parts[0] === 'estadisticas') return { view: 'stats' };
  return { view: 'calendar' };
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch (error) {
    console.warn('Ruta con codificación inválida', error);
    return text;
  }
}

export function hrefFor(route: Route): string {
  if (route.view === 'videos') return route.videoId === null ? '#/videos' : `#/videos/${encodeURIComponent(route.videoId)}`;
  if (route.view === 'stats') return '#/estadisticas';
  return '#/';
}

export const videoHref = (id: string): string => hrefFor({ view: 'videos', videoId: id });

export function navigate(route: Route): void {
  window.location.hash = hrefFor(route);
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => {
    window.removeEventListener('hashchange', listener);
  };
}

const getHash = (): string => window.location.hash;
const getServerHash = (): string => '';

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash, getServerHash);
  return useMemo(() => parseHash(hash), [hash]);
}
