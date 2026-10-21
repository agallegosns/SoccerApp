import { BarChart3, CalendarDays, Film } from 'lucide-react';

import { hrefFor, type Route } from './route.ts';

interface Props {
  readonly route: Route;
  readonly videoCount: number;
  /** Se llama al pulsar cualquier sección (p. ej. para cerrar el estudio abierto). */
  readonly onNavigate: () => void;
}

const ITEMS = [
  { view: 'calendar', label: 'Calendario', Icon: CalendarDays },
  { view: 'videos', label: 'Vídeos', Icon: Film },
  { view: 'stats', label: 'Estadísticas', Icon: BarChart3 },
] as const;

/** Menú principal: barra superior en pantallas anchas y barra inferior fija en el móvil (siempre al alcance del pulgar, sin desplazamiento). */
export function AppNav({ route, videoCount, onNavigate }: Props) {
  return (
    <nav className="appnav" aria-label="Secciones">
      <ul className="appnav__list plain-list">
        {ITEMS.map(({ view, label, Icon }) => {
          const current = route.view === view;
          const target: Route = view === 'videos' ? { view, videoId: null } : { view };
          return (
            <li key={view} className="appnav__item">
              <a className="appnav__link" href={hrefFor(target)} aria-current={current ? 'page' : undefined} onClick={onNavigate} data-testid={`nav-${view}`}>
                <Icon aria-hidden="true" size={22} />
                <span>{label}</span>
                {view === 'videos' && videoCount > 0 && (
                  <span className="appnav__count" aria-label={`${String(videoCount)} vídeos`}>
                    {videoCount}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
