import { AlertTriangle, CalendarDays, Clock, FileUp, RefreshCw, Search, WifiOff } from 'lucide-react';
import { useMemo, useState } from 'react';

import { formatDateEs, todayLocal } from '../../data/dates.ts';
import type { ImportedProvider } from '../../data/imported.ts';
import type { MatchService } from '../../data/registry.ts';
import type { League, Match } from '../../data/types.ts';
import { DEFAULT_FILTERS, filterMatches, groupByDate, type Filters, type Scope } from './filters.ts';
import { ImportDialog, type ImportPreset } from './ImportDialog.tsx';
import { LeaguePicker } from './LeaguePicker.tsx';
import { MatchCard } from './MatchCard.tsx';
import { SelectedMatch } from './SelectedMatch.tsx';
import { useLeagueMatches } from './useLeagueMatches.ts';
import { readJson, writeJson } from '../../data/cache.ts';
import { useDownloaded } from '../../ui/useDownloaded.ts';
import './calendar.css';

const PAGE_SIZE = 60;
const SCOPES: readonly { value: Scope; label: string }[] = [
  { value: 'upcoming', label: 'Próximos' },
  { value: 'played', label: 'Jugados' },
  { value: 'all', label: 'Todos' },
];

const isString = (v: unknown): v is string => typeof v === 'string';

function initialLeague(leagues: readonly League[]): string {
  const saved = readJson('ui-league', isString);
  return leagues.find((l) => l.id === saved)?.id ?? leagues[0]?.id ?? '';
}

interface Props {
  readonly service: MatchService;
  readonly imported: ImportedProvider;
  readonly selected: Match | null;
  readonly onSelect: (match: Match | null) => void;
  readonly onSimulate: (match: Match) => void;
}

export function CalendarView({ service, imported, selected, onSelect, onSimulate }: Props) {
  const downloaded = useDownloaded();
  const [version, setVersion] = useState(0);
  const leagues = useMemo(() => service.listLeagues(), [service, version]); // eslint-disable-line react-hooks/exhaustive-deps -- `version` fuerza la relectura tras importar/eliminar
  const [leagueId, setLeagueId] = useState(() => initialLeague(service.listLeagues()));
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [importOpen, setImportOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false); // en el móvil las fechas se despliegan a demanda
  const [preset, setPreset] = useState<{ value?: ImportPreset; nonce: number }>({ nonce: 0 });

  function openImport(value?: ImportPreset): void {
    setPreset((p) => (value === undefined ? { nonce: p.nonce + 1 } : { value, nonce: p.nonce + 1 }));
    setImportOpen(true);
  }

  const league = leagues.find((l) => l.id === leagueId) ?? leagues[0];
  const activeId = league?.id ?? '';
  const awaiting = league?.awaitingImport === true;
  const state = useLeagueMatches(service, awaiting ? '' : activeId, version);
  const today = todayLocal();

  const filtered = useMemo(
    () => (state.status === 'ready' ? filterMatches(state.matches, filters, today) : []),
    [state, filters, today],
  );
  const groups = useMemo(() => groupByDate(filtered.slice(0, visible)), [filtered, visible]);

  function chooseLeague(id: string): void {
    setLeagueId(id);
    setVisible(PAGE_SIZE);
    onSelect(null);
    try {
      writeJson('ui-league', id);
    } catch (error) {
      console.warn('No se pudo recordar la liga elegida', error);
    }
  }

  function updateFilters(patch: Partial<Filters>): void {
    setFilters((f) => ({ ...f, ...patch }));
    setVisible(PAGE_SIZE);
  }

  const filtersActive = filters.query !== '' || filters.from !== '' || filters.to !== '' || filters.scope !== DEFAULT_FILTERS.scope;

  return (
    <div className="calendar">
      <div className="calendar__main">
        <div className="calendar__title">
          <h1>Calendario de partidos</h1>
          <p className="muted">Datos reales de fuentes abiertas. Las simulaciones que generes serán ficticias.</p>
        </div>

        <LeaguePicker leagues={leagues} activeId={activeId} onChoose={chooseLeague} onImport={() => { openImport(); }} />

        <form className="filters" role="search" aria-label="Filtros" onSubmit={(e) => { e.preventDefault(); }}>
          <label className="field field--search">
            <span className="visually-hidden">Buscar equipo</span>
            <Search aria-hidden="true" size={18} />
            <input
              type="search"
              placeholder="Buscar equipo o jornada"
              value={filters.query}
              onChange={(e) => { updateFilters({ query: e.target.value }); }}
            />
          </label>
          <div className="segmented" role="group" aria-label="Partidos a mostrar">
            {SCOPES.map((s) => (
              <button
                key={s.value}
                type="button"
                aria-pressed={filters.scope === s.value}
                onClick={() => { updateFilters({ scope: s.value }); }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn filters__toggle"
            aria-expanded={datesOpen || filters.from !== '' || filters.to !== ''}
            onClick={() => { setDatesOpen((o) => !o); }}
          >
            <CalendarDays aria-hidden="true" size={18} />
            Filtrar por fechas
          </button>
          <div className="filters__dates" data-open={datesOpen || filters.from !== '' || filters.to !== ''}>
            <label className="field">
              <span>Desde</span>
              <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => { updateFilters({ from: e.target.value }); }} />
            </label>
            <label className="field">
              <span>Hasta</span>
              <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => { updateFilters({ to: e.target.value }); }} />
            </label>
          </div>
          {filtersActive && (
            <button type="button" className="btn" onClick={() => { setFilters(DEFAULT_FILTERS); setVisible(PAGE_SIZE); }}>
              Limpiar filtros
            </button>
          )}
        </form>

        {league !== undefined && (
          <div className="infos">
            {league.note !== undefined && (
              <p className="notice notice--soft">
                <AlertTriangle aria-hidden="true" size={18} />
                <span>{league.note}</span>
              </p>
            )}
            <p className="notice notice--soft">
              <Clock aria-hidden="true" size={18} />
              <span>{league.timeNote}</span>
            </p>
            {state.status === 'ready' && state.stale && (
              <p className="notice notice--warn" role="status">
                <WifiOff aria-hidden="true" size={18} />
                <span>
                  Sin conexión con la fuente: mostrando la copia guardada el{' '}
                  {new Date(state.savedAt).toLocaleString('es-ES')}.
                </span>
                <button type="button" className="btn btn--small" onClick={state.reload}>
                  <RefreshCw aria-hidden="true" size={16} />
                  Reintentar
                </button>
              </p>
            )}
          </div>
        )}

        {awaiting && (
          <div className="empty" data-testid="awaiting">
            <p>
              <strong>
                {league.name} {league.season}
              </strong>{' '}
              está preparada pero aún no tiene calendario.
            </p>
            <p>Importa tu archivo (Excel con Jornada, Fecha, Hora, Equipo Local y Equipo Visitante, o JSON/TXT) y aparecerá aquí.</p>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => { openImport({ name: league.name, season: league.season }); }}
            >
              <FileUp aria-hidden="true" size={18} />
              Importar calendario de {league.name}
            </button>
          </div>
        )}

        {state.status === 'loading' && (
          <div className="skeletons" role="status" aria-label="Cargando partidos">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="skeleton" />
            ))}
          </div>
        )}

        {state.status === 'error' && (
          <div className="alert alert--error" role="alert">
            <AlertTriangle aria-hidden="true" size={20} />
            <div>
              <p>
                <strong>No se pudo cargar el calendario.</strong> {state.error.message}
              </p>
              <p className="muted">Comprueba tu conexión; se reintentó automáticamente antes de mostrar este aviso.</p>
              <button type="button" className="btn btn--primary" onClick={state.reload}>
                <RefreshCw aria-hidden="true" size={18} />
                Reintentar
              </button>
            </div>
          </div>
        )}

        {state.status === 'ready' && (
          <>
            <p className="count" role="status" data-testid="count">
              {filtered.length === 1 ? '1 partido' : `${String(filtered.length)} partidos`}
              {state.matches.length !== filtered.length && ` de ${String(state.matches.length)}`}
            </p>
            {filtered.length === 0 ? (
              <div className="empty">
                <p>No hay partidos con estos filtros.</p>
                {filters.scope === 'upcoming' && state.matches.length > 0 && (
                  <button type="button" className="btn" onClick={() => { updateFilters({ scope: 'all' }); }}>
                    Ver todos los partidos
                  </button>
                )}
                {filtersActive && (
                  <button type="button" className="btn" onClick={() => { setFilters(DEFAULT_FILTERS); }}>
                    Limpiar filtros
                  </button>
                )}
              </div>
            ) : (
              <div className="days">
                {groups.map((group) => (
                  <section key={group.date} className="day" aria-labelledby={`day-${group.date}`}>
                    <h2 id={`day-${group.date}`} className="day__title">
                      {formatDateEs(group.date)}
                    </h2>
                    <ul className="plain-list">
                      {group.matches.map((m) => (
                        <li key={m.id}>
                          <MatchCard match={m} selected={selected?.id === m.id} downloaded={downloaded.has(m.id)} onSelect={onSelect} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
                {filtered.length > visible && (
                  <button type="button" className="btn calendar__more" onClick={() => { setVisible((v) => v + PAGE_SIZE); }}>
                    Mostrar más ({filtered.length - visible} restantes)
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="calendar__side">
        <SelectedMatch match={selected} onClear={() => { onSelect(null); }} onSimulate={onSimulate} />
      </div>

      <ImportDialog
        key={preset.nonce}
        open={importOpen}
        {...(preset.value === undefined ? {} : { preset: preset.value })}
        imported={imported}
        onClose={() => { setImportOpen(false); }}
        onChanged={(added) => {
          setVersion((v) => v + 1);
          if (added !== null) chooseLeague(added.id);
        }}
      />
    </div>
  );
}
