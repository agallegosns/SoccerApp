import { ArrowLeft, Dices } from 'lucide-react';
import { useMemo, useState } from 'react';

import { formatDateEs, kickoffOf } from '../../data/dates.ts';
import type { Match } from '../../data/types.ts';
import { MAX_GOALS_PER_TEAM, simulate, type Pace, type Score } from '../../engine/index.ts';
import { BatchPanel } from '../export/BatchPanel.tsx';
import { ExportPanel } from '../export/ExportPanel.tsx';
import { exportFileName } from '../export/fileName.ts';
import { CrestsPanel } from './CrestsPanel.tsx';
import { DEFAULT_VIDEO_OPTIONS, loadVideoOptions, saveVideoOptions, type VideoOptions } from './options.ts';
import { VideoOptionsPanel } from './VideoOptionsPanel.tsx';
import { SimulationPreview } from './SimulationPreview.tsx';
import { useTeamCrests } from './useTeamCrests.ts';
import { DEFAULT_STYLE, VIDEO_STYLES, type VideoStyle } from './renderers.ts';
import type { RenderMeta } from './render.ts';
import './studio.css';

interface Props {
  readonly match: Match;
  readonly onBack: () => void;
}

const MAX_SEED = 2 ** 32 - 1;
const randomSeed = (): number => Math.floor(Math.random() * 1_000_000_000);

function clampGoals(value: string): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(MAX_GOALS_PER_TEAM, Math.max(0, n)) : 0;
}

const EVENT_LABELS: Readonly<Record<string, string>> = {
  kickoff: 'Saque',
  shot: 'Disparo',
  goal: 'Gol',
  save: 'Parada',
  miss: 'Fuera',
  post: 'Palo',
  block: 'Bloqueo',
  foul: 'Falta',
  corner: 'Córner',
  halftime: 'Descanso',
  fulltime: 'Final',
};

export function SimulationStudio({ match, onBack }: Props) {
  const [seed, setSeed] = useState(randomSeed);
  const [seedText, setSeedText] = useState(String(seed));
  const [fixed, setFixed] = useState(false);
  const [fixedHome, setFixedHome] = useState(1);
  const [fixedAway, setFixedAway] = useState(0);
  const [seek, setSeek] = useState<{ t: number; nonce: number } | null>(null);
  const [style, setStyle] = useState<VideoStyle>(DEFAULT_STYLE);
  const [pace, setPace] = useState<Pace>('fast');
  const crests = useTeamCrests(match.home, match.away);
  const [options, setOptions] = useState<VideoOptions>(loadVideoOptions);

  function changeOptions(patch: Partial<VideoOptions>): void {
    const next = { ...options, ...patch }; // los campos de texto ya limitan su longitud (maxLength); al cargar se validan con sanitizeOptions
    setOptions(next);
    saveVideoOptions(next);
  }

  function resetOptions(): void {
    setOptions(DEFAULT_VIDEO_OPTIONS);
    saveVideoOptions(DEFAULT_VIDEO_OPTIONS);
  }

  const score: Score | null = fixed ? { home: fixedHome, away: fixedAway } : null;
  const sim = useMemo(
    () => simulate({ seed, home: match.home, away: match.away, score: fixed ? { home: fixedHome, away: fixedAway } : null, pace }),
    [seed, match.home, match.away, fixed, fixedHome, fixedAway, pace],
  );

  const kickoff = kickoffOf(match);
  const meta: RenderMeta = useMemo(
    () => ({
      competition: `${match.competition} · ${match.round}`,
      when: `${formatDateEs(kickoff.date)} · ${kickoff.time ?? 'hora por confirmar'}`,
      options,
    }),
    [match.competition, match.round, kickoff.date, kickoff.time, options],
  );

  const seedValid = /^\d+$/.test(seedText) && Number(seedText) <= MAX_SEED;
  const { teams, stats } = sim.script;
  const final = sim.script.score;

  function applySeed(text: string): void {
    setSeedText(text);
    if (/^\d+$/.test(text) && Number(text) <= MAX_SEED) setSeed(Number(text));
  }

  return (
    <div className="studio">
      <div className="studio__bar">
        <button type="button" className="btn" onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={20} />
          Volver al calendario
        </button>
        <span className="badge">Simulación ficticia</span>
      </div>

      <header className="studio__head">
        <h1>
          {match.home} <span className="muted">vs</span> {match.away}
        </h1>
        <p className="muted">
          {match.competition} · {match.round} · {formatDateEs(kickoff.date)}
          {kickoff.time !== null && ` · ${kickoff.time}`}
        </p>
        {match.realScore !== null && (
          <p className="studio__real">
            Resultado real (dato, no simulado): <strong>{match.realScore.home}–{match.realScore.away}</strong>
          </p>
        )}
      </header>

      <div className="studio__grid">
        <section className="studio__preview" aria-label="Vista previa">
          <SimulationPreview
            key={`${String(seed)}|${fixed ? `${String(fixedHome)}-${String(fixedAway)}` : 'r'}|${pace}`}
            sim={sim}
            crestVersion={crests.version}
            meta={meta}
            label={`Vista previa de la simulación ficticia de ${match.home} contra ${match.away}`}
            style={style}
            seek={seek}
          />
        </section>

        <section className="studio__side">
          <div className="card" aria-label="Parámetros">
            <h2>Parámetros</h2>
            <div className="segmented" role="group" aria-label="Estilo del vídeo">
              {VIDEO_STYLES.map((v) => (
                <button key={v.id} type="button" aria-pressed={style === v.id} title={v.hint} onClick={() => { setStyle(v.id); }} data-testid={`style-${v.id}`}>
                  {v.label}
                </button>
              ))}
            </div>
            <p className="muted">{VIDEO_STYLES.find((v) => v.id === style)?.hint}</p>

            <div className="segmented" role="group" aria-label="Ritmo del vídeo">
              <button type="button" aria-pressed={pace === 'fast'} onClick={() => { setPace('fast'); }} data-testid="pace-fast">
                Ritmo rápido
              </button>
              <button type="button" aria-pressed={pace === 'normal'} onClick={() => { setPace('normal'); }} data-testid="pace-normal">
                Ritmo normal
              </button>
            </div>
            <p className="muted">
              {pace === 'fast'
                ? 'Más acción en menos tiempo y arranque inmediato: pensado para que el vídeo se vea entero y enganche.'
                : 'Ritmo pausado: los mismos sucesos, con más calma entre jugadas.'}
            </p>

            <label className="field">
              <span>Semilla (cada semilla da una simulación distinta del mismo partido)</span>
              <div className="row">
                <input
                  inputMode="numeric"
                  value={seedText}
                  onChange={(e) => { applySeed(e.target.value); }}
                  aria-invalid={!seedValid}
                  data-testid="seed-input"
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const next = randomSeed();
                    setSeed(next);
                    setSeedText(String(next));
                  }}
                  data-testid="new-seed"
                >
                  <Dices aria-hidden="true" size={20} />
                  Otra semilla
                </button>
              </div>
            </label>
            {!seedValid && (
              <p className="alert alert--error" role="alert">
                La semilla debe ser un entero entre 0 y {MAX_SEED}.
              </p>
            )}

            <div className="segmented" role="group" aria-label="Marcador de la simulación">
              <button type="button" aria-pressed={!fixed} onClick={() => { setFixed(false); }}>
                Marcador aleatorio
              </button>
              <button type="button" aria-pressed={fixed} onClick={() => { setFixed(true); }} data-testid="fix-score">
                Fijar marcador
              </button>
            </div>
            {fixed && (
              <div className="row row--scores">
                <label className="field">
                  <span>{match.home}</span>
                  <input
                    type="number"
                    min={0}
                    max={MAX_GOALS_PER_TEAM}
                    value={fixedHome}
                    onChange={(e) => { setFixedHome(clampGoals(e.target.value)); }}
                    data-testid="score-home"
                  />
                </label>
                <label className="field">
                  <span>{match.away}</span>
                  <input
                    type="number"
                    min={0}
                    max={MAX_GOALS_PER_TEAM}
                    value={fixedAway}
                    onChange={(e) => { setFixedAway(clampGoals(e.target.value)); }}
                    data-testid="score-away"
                  />
                </label>
              </div>
            )}
            {fixed && score !== null && score.home + score.away > 6 && (
              <p className="muted">Con muchos goles el vídeo dura más (aprox. {Math.round(sim.script.duration)} s).</p>
            )}
          </div>

          <VideoOptionsPanel options={options} style={style} onChange={changeOptions} onReset={resetOptions} />

          <CrestsPanel teams={[sim.script.teams.home, sim.script.teams.away]} crests={crests} />

          <ExportPanel
            key={`${String(seed)}|${fixed ? `${String(fixedHome)}-${String(fixedAway)}` : 'r'}|${style}|${pace}|${String(crests.version)}|${JSON.stringify(options)}`}
            sim={sim}
            meta={meta}
            style={style}
            fileName={exportFileName({ competition: match.competition, home: match.home, away: match.away, date: kickoff.date, seed })}
            title={`Simulación ficticia: ${match.home} vs ${match.away}`}
            matchId={match.id}
          />

          <BatchPanel
            match={match}
            date={kickoff.date}
            currentSeed={seed}
            style={style}
            fixedScore={score}
            pace={pace}
            meta={meta}
            onUseSeed={(s) => {
              setSeed(s);
              setSeedText(String(s));
            }}
          />

          <div className="card" aria-label="Resultado de la simulación">
            <h2>Esta simulación</h2>
            <p className="studio__score" data-testid="sim-score">
              {match.home} {final.home}–{final.away} {match.away}
            </p>
            <p className="muted">Marcador ficticio {sim.script.scoreWasFixed ? 'fijado por ti' : 'decidido por la semilla'}. Duración: {sim.script.duration.toFixed(0)} s.</p>
            <table className="stats">
              <caption className="visually-hidden">Estadísticas ficticias de la simulación</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="visually-hidden">Estadística</span>
                  </th>
                  <th scope="col">{teams.home.style.abbr} {teams.home.formation}</th>
                  <th scope="col">{teams.away.style.abbr} {teams.away.formation}</th>
                </tr>
              </thead>
              <tbody>
                {(['shots', 'onTarget', 'corners', 'fouls'] as const).map((key) => (
                  <tr key={key}>
                    <th scope="row">{{ shots: 'Tiros', onTarget: 'A puerta', corners: 'Córners', fouls: 'Faltas' }[key]}</th>
                    <td>{stats.home[key]}</td>
                    <td>{stats.away[key]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" aria-label="Sucesos">
            <h2>Sucesos</h2>
            <ol className="events plain-list" data-testid="events">
              {sim.script.events
                .filter((e) => e.type !== 'kickoff')
                .map((e) => (
                  <li key={`${String(e.t)}-${e.type}`}>
                    <button
                      type="button"
                      className={`event event--${e.type}`}
                      onClick={() => { setSeek((s) => ({ t: Math.max(0, e.t - 2.5 * sim.script.timeScale), nonce: (s?.nonce ?? 0) + 1 })); }}
                    >
                      <span className="event__clock">{e.clock}</span>
                      <span className="event__type">{EVENT_LABELS[e.type] ?? e.type}</span>
                      <span className="event__text">{e.text}</span>
                    </button>
                  </li>
                ))}
            </ol>
          </div>
        </section>
      </div>
    </div>
  );
}
