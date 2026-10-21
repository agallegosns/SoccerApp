import { FileUp } from 'lucide-react';

import type { League } from '../../data/types.ts';
import { leagueBadge } from './leagueBadge.ts';

interface Props {
  readonly leagues: readonly League[];
  readonly activeId: string;
  readonly onChoose: (id: string) => void;
  readonly onImport: () => void;
}

/** Selector de competición: tarjetas grandes repartidas en una rejilla que ocupa varias filas (sin desplazamiento lateral). */
export function LeaguePicker({ leagues, activeId, onChoose, onImport }: Props) {
  return (
    <div className="leagues" role="group" aria-label="Competición">
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
