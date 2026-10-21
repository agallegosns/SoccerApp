import { Bell, CheckCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { videoHref } from '../../app/route.ts';
import { usePublished, togglePublished } from './published.ts';
import { formatScheduled, publishState, useScheduled } from './scheduled.ts';
import { useVideos } from './store.ts';

const SNOOZE_MS = 10 * 60_000;
const TICK_MS = 20_000;

const canNotify = (): boolean => typeof Notification !== 'undefined';

/**
 * Cuando llega la hora a la que programaste un vídeo, pregunta si ya se ha publicado; al decir que sí pasa a «Publicado».
 * Sólo funciona con la app abierta: no hay servidor que envíe avisos con la app cerrada. Si has dado permiso, además
 * muestra una notificación del navegador en ese momento (en iPhone sólo con la app instalada en la pantalla de inicio).
 */
export function DuePrompt() {
  const videos = useVideos();
  const published = usePublished();
  const scheduled = useScheduled();
  const [now, setNow] = useState(() => Date.now());
  const [snoozed, setSnoozed] = useState<Readonly<Record<string, number>>>({});
  const [permission, setPermission] = useState<NotificationPermission | 'none'>(() => (canNotify() ? Notification.permission : 'none'));
  const notified = useRef(new Set<string>());

  useEffect(() => {
    const id = window.setInterval(() => { setNow(Date.now()); }, TICK_MS);
    const onVisible = (): void => { setNow(Date.now()); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const due = videos.filter((v) => publishState(v.id, published, scheduled, now) === 'due' && (snoozed[v.id] ?? 0) <= now);
  const pending = videos.filter((v) => publishState(v.id, published, scheduled, now) === 'scheduled');

  useEffect(() => {
    if (permission !== 'granted') return;
    for (const v of due) {
      const key = `${v.id}@${scheduled[v.id] ?? ''}`;
      if (notified.current.has(key)) continue;
      notified.current.add(key);
      try {
        new Notification('¿Ya se ha publicado?', { body: `${v.match.home} vs ${v.match.away} · programado ${formatScheduled(scheduled[v.id] ?? '')}` });
      } catch (error) {
        console.warn('No se pudo mostrar la notificación', error);
      }
    }
  }, [due, permission, scheduled]);

  async function enable(): Promise<void> {
    try {
      setPermission(await Notification.requestPermission());
    } catch (error) {
      console.warn('No se pudo pedir permiso de notificaciones', error);
    }
  }

  if (due.length === 0 && !(pending.length > 0 && permission === 'default')) return null;

  return (
    <section className="due" aria-label="Vídeos programados" data-testid="due-prompt">
      {due.map((v) => (
        <div className="notice notice--warn due__item" role="status" key={v.id} data-testid="due-item">
          <div className="due__text">
            <strong>¿Se ha publicado {v.match.home} vs {v.match.away}?</strong>
            <span>Lo programaste para {formatScheduled(scheduled[v.id] ?? '')}.</span>
          </div>
          <div className="due__actions">
            <button type="button" className="btn btn--primary" onClick={() => { togglePublished(v.id); }} data-testid="due-yes">
              <CheckCheck aria-hidden="true" size={18} />
              Sí, ya está publicado
            </button>
            <button type="button" className="btn" onClick={() => { setSnoozed((s) => ({ ...s, [v.id]: Date.now() + SNOOZE_MS })); }} data-testid="due-later">
              Todavía no
            </button>
            <a className="btn" href={videoHref(v.id)} data-testid="due-open">
              Cambiar hora
            </a>
          </div>
        </div>
      ))}
      {pending.length > 0 && permission === 'default' && (
        <div className="notice notice--soft due__item" data-testid="due-enable">
          <div className="due__text">
            <span>Tienes {String(pending.length)} {pending.length === 1 ? 'vídeo programado' : 'vídeos programados'}. Puedes activar el aviso del navegador para que suene a la hora (sólo con la app abierta).</span>
          </div>
          <div className="due__actions">
            <button type="button" className="btn" onClick={() => void enable()} data-testid="due-enable-btn">
              <Bell aria-hidden="true" size={18} />
              Activar aviso
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

