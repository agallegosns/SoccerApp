import { CalendarDays, X } from 'lucide-react';

import { formatDateEs, kickoffOf } from '../../data/dates.ts';
import type { Match } from '../../data/types.ts';

interface Props {
  readonly match: Match | null;
  readonly onClear: () => void;
}

export function SelectedMatch({ match, onClear }: Props) {
  if (match === null) {
    return (
      <aside className="selected selected--empty" aria-label="Partido seleccionado">
        <CalendarDays aria-hidden="true" size={24} />
        <p>Selecciona un partido del calendario para generar simulaciones ficticias.</p>
      </aside>
    );
  }
  const kickoff = kickoffOf(match);
  return (
    <aside className="selected" aria-label="Partido seleccionado" data-testid="selected-match">
      <div className="selected__head">
        <span className="selected__comp">
          {match.competition} · {match.round}
        </span>
        <button type="button" className="icon-btn" onClick={onClear} aria-label="Quitar selección">
          <X aria-hidden="true" size={20} />
        </button>
      </div>
      <p className="selected__teams">
        <span>{match.home}</span>
        <span className="selected__vs">vs</span>
        <span>{match.away}</span>
      </p>
      <p className="selected__when">
        {formatDateEs(kickoff.date)} · {kickoff.time ?? 'hora por confirmar'}
        {kickoff.converted && ' (tu hora)'}
      </p>
      {match.realScore !== null && (
        <p className="selected__real">
          Resultado real: <strong>{match.realScore.home}–{match.realScore.away}</strong>
          {match.realScore.note !== undefined && ` (${match.realScore.note})`}
        </p>
      )}
      <p className="notice notice--soft">
        <span>
          La generación de simulaciones se incorpora en la Fase 3. Toda simulación será <strong>ficticia</strong>, nunca una predicción.
        </span>
      </p>
    </aside>
  );
}
