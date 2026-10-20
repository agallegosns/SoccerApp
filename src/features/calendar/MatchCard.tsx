import { Check, CircleCheck } from 'lucide-react';

import { kickoffOf } from '../../data/dates.ts';
import type { Match } from '../../data/types.ts';

interface Props {
  readonly match: Match;
  readonly selected: boolean;
  /** Ya se ha descargado algún vídeo de este partido: la tarjeta se pinta de verde. */
  readonly downloaded: boolean;
  readonly onSelect: (match: Match) => void;
}

export function MatchCard({ match, selected, downloaded, onSelect }: Props) {
  const kickoff = kickoffOf(match);
  const scoreText = match.realScore === null ? null : `${String(match.realScore.home)}–${String(match.realScore.away)}`;
  return (
    <button
      type="button"
      className={downloaded ? 'match match--downloaded' : 'match'}
      aria-pressed={selected}
      onClick={() => { onSelect(match); }}
    >
      <span className="match__time">
        {kickoff.time ?? <span className="match__tbc">Hora por confirmar</span>}
        {kickoff.converted && <span className="match__tz">tu hora</span>}
      </span>
      <span className="match__teams">
        <span className="match__team">{match.home}</span>
        <span className="visually-hidden"> contra </span>
        <span className="match__team">{match.away}</span>
      </span>
      <span className="match__meta">
        <span className="match__round">{match.round}</span>
        {downloaded && (
          <span className="chip chip--done">
            <CircleCheck aria-hidden="true" size={14} />
            Descargado
          </span>
        )}
        {scoreText !== null && (
          <span className="chip chip--real" title="Resultado real, no simulado">
            Real {scoreText}
          </span>
        )}
      </span>
      {selected && <Check className="match__check" aria-hidden="true" size={20} />}
    </button>
  );
}
