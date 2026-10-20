import { Check, Circle, CircleCheck } from 'lucide-react';

import { kickoffOf } from '../../data/dates.ts';
import type { Match } from '../../data/types.ts';

interface Props {
  readonly match: Match;
  readonly selected: boolean;
  /** Partido «hecho» (vídeo descargado o marcado a mano): la tarjeta se pinta de verde. */
  readonly done: boolean;
  readonly onSelect: (match: Match) => void;
  readonly onToggleDone: (match: Match) => void;
}

export function MatchCard({ match, selected, done, onSelect, onToggleDone }: Props) {
  const kickoff = kickoffOf(match);
  const scoreText = match.realScore === null ? null : `${String(match.realScore.home)}–${String(match.realScore.away)}`;
  return (
    <div className="match-wrap">
    <button
      type="button"
      className={done ? 'match match--downloaded' : 'match'}
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
        {done && (
          <span className="chip chip--done">
            <CircleCheck aria-hidden="true" size={14} />
            Hecho
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
    <button
      type="button"
      className="match__done"
      aria-pressed={done}
      aria-label={`Marcar ${match.home} contra ${match.away} como hecho`}
      onClick={() => { onToggleDone(match); }}
    >
      {done ? <CircleCheck aria-hidden="true" size={24} /> : <Circle aria-hidden="true" size={24} />}
    </button>
    </div>
  );
}
