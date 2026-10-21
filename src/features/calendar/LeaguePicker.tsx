import { ChevronDown, FileUp } from 'lucide-react';
import { useId, useState } from 'react';

import type { League } from '../../data/types.ts';
import { leagueBadge } from './leagueBadge.ts';

interface Props {
  readonly leagues: readonly League[];
  readonly activeId: string;
  readonly onChoose: (id: string) => void;
  readonly onImport: () => void;
}

/** Selector de competición: en el móvil es un botón que despliega la lista (ocupa una sola fila); en pantallas anchas, una rejilla compacta siempre visible. */
export function LeaguePicker({ leagues, activeId, onChoose, onImport }: Props) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const active = leagues.find((l) => l.id === activeId);
  return (
    <div className="league-picker">
      <button
        type="button"
        className="league-current"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => { setOpen((o) => !o); }}
      >
        <span className="league__badge" aria-hidden="true">{leagueBadge(active?.name ?? '?')}</span>
        <span className="league__text">
          <span className="league-current__hint">Competición</span>
          <span className="league__name">{active === undefined ? 'Elegir competición' : `${active.name} ${active.season}`}</span>
        </span>
        <ChevronDown aria-hidden="true" size={20} className="league-current__chevron" />
      </button>
    <div className="leagues" id={listId} data-open={open} role="group" aria-label="Competición">
      {leagues.map((l) => (
        <button
          key={l.id}
          type="button"
          className="league"
          aria-pressed={l.id === activeId}
          onClick={() => { onChoose(l.id); setOpen(false); }}
        >
          <span className="league__badge" aria-hidden="true">{leagueBadge(l.name)}</span>
          <span className="league__text">
            <span className="league__name">{l.name}</span>
            <span className="league__season">{l.season}</span>
          </span>
        </button>
      ))}
      <button type="button" className="league league--import" onClick={() => { setOpen(false); onImport(); }}>
        <span className="league__badge" aria-hidden="true">
          <FileUp aria-hidden="true" size={20} />
        </span>
        <span className="league__text">
          <span className="league__name">Importar calendario</span>
          <span className="league__season">Excel o JSON</span>
        </span>
      </button>
    </div>
    </div>
  );
}
