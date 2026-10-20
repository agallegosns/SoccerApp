import { FileUp } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { League } from '../../data/types.ts';
import { leagueBadge } from './leagueBadge.ts';

interface Props {
  readonly leagues: readonly League[];
  readonly activeId: string;
  readonly onChoose: (id: string) => void;
  readonly onImport: () => void;
}

/**
 * Selector de competición pensado para el móvil: tarjetas grandes en una tira con desplazamiento horizontal y «imán»
 * (en pantallas grandes se reparten en rejilla). La elegida se centra sola.
 */
export function LeaguePicker({ leagues, activeId, onChoose, onImport }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strip = stripRef.current;
    const active = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (strip === null || active === null || active === undefined) return;
    // Sólo se mueve la propia tira (scrollIntoView movería también la página).
    strip.scrollTo({ left: active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2, behavior: 'auto' });
  }, [activeId]);

  return (
    <div className="leagues" role="group" aria-label="Competición" ref={stripRef}>
      {leagues.map((l) => (
        <button
          key={l.id}
          type="button"
          className="league"
          aria-pressed={l.id === activeId}
          onClick={() => { onChoose(l.id); }}
        >
          <span className="league__badge" aria-hidden="true">{leagueBadge(l.name)}</span>
          <span className="league__text">
            <span className="league__name">{l.name}</span>
            <span className="league__season">{l.season}</span>
          </span>
        </button>
      ))}
      <button type="button" className="league league--import" onClick={onImport}>
        <span className="league__badge" aria-hidden="true">
          <FileUp aria-hidden="true" size={20} />
        </span>
        <span className="league__text">
          <span className="league__name">Importar calendario</span>
          <span className="league__season">Excel o JSON</span>
        </span>
      </button>
    </div>
  );
}
