import { Calendar, CalendarClock, Check, CheckCheck, Film, ListChecks, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { videoHref } from '../../app/route.ts';
import { formatDateEs, kickoffOf } from '../../data/dates.ts';
import { ConfirmDialog } from '../../ui/ConfirmDialog.tsx';
import { useDownloaded } from '../../ui/useDownloaded.ts';
import { useNow } from '../../ui/useNow.ts';
import { platformLabel } from '../stats/model.ts';
import { usePublications } from '../stats/store.ts';
import { filterVideos, formatBytes, type VideoFilter, type VideoRecord } from './model.ts';
import { usePublished } from './published.ts';
import { formatScheduled, publishState, useScheduled } from './scheduled.ts';
import { removeVideos, useVideos } from './store.ts';
import './videos.css';

const styleLabel = (v: VideoRecord): string => (v.style === 'arena' ? 'Arena' : 'Táctico');

export function VideosView() {
  const videos = useVideos();
  const downloaded = useDownloaded();
  const pubs = usePublications();
  const published = usePublished();
  const scheduled = useScheduled();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [toDelete, setToDelete] = useState<readonly string[] | null>(null);
  const now = useNow();
  const [filter, setFilter] = useState<VideoFilter>({ text: '', competition: '', downloaded: 'all', published: 'all' });

  const competitions = [...new Set(videos.map((v) => v.match.competition))].sort((a, b) => a.localeCompare(b));
  const shown = filterVideos(videos, filter, downloaded, new Set(Object.keys(published)), new Set(Object.keys(scheduled)));

  return (
    <div className="videos" data-testid="videos-view">
      <header className="section-head">
        <div>
          <h1>Vídeos</h1>
          <p className="muted intro">Todos los vídeos que has exportado. Abre la ficha de uno para revisarlo, volver a descargarlo, copiar su descripción o ver cómo rinde.</p>
        </div>
        <a className="btn btn--primary" href="#/">
          <Calendar aria-hidden="true" size={20} />
          Crear otro vídeo
        </a>
      </header>

      {videos.length === 0 ? (
        <div className="empty" data-testid="videos-empty">
          <Film aria-hidden="true" size={32} />
          <h2>Todavía no has exportado ningún vídeo</h2>
          <p className="muted">Elige un partido en el calendario, abre el estudio y pulsa «Exportar MP4» o genera un lote. Aquí aparecerá la ficha de cada vídeo.</p>
          <a className="btn btn--primary" href="#/">
            Ir al calendario
          </a>
        </div>
      ) : (
        <>
          <div className="filters-row">
            <label className="field field--search">
              <span className="visually-hidden">Buscar vídeo</span>
              <Search aria-hidden="true" size={18} />
              <input
                type="search"
                placeholder="Buscar equipo, competición o semilla"
                value={filter.text}
                onChange={(e) => { setFilter({ ...filter, text: e.target.value }); }}
                data-testid="videos-search"
              />
            </label>
            <label className="field">
              <span className="visually-hidden">Competición</span>
              <select value={filter.competition} onChange={(e) => { setFilter({ ...filter, competition: e.target.value }); }} data-testid="videos-competition">
                <option value="">Todas las ligas</option>
                {competitions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="visually-hidden">Descarga</span>
              <select value={filter.downloaded} onChange={(e) => { setFilter({ ...filter, downloaded: e.target.value === 'yes' ? 'yes' : e.target.value === 'no' ? 'no' : 'all' }); }} data-testid="videos-downloaded">
                <option value="all">Cualquiera</option>
                <option value="yes">Solo descargados</option>
                <option value="no">Sin descargar</option>
              </select>
            </label>
            <label className="field">
              <span className="visually-hidden">Publicación</span>
              <select value={filter.published} onChange={(e) => { setFilter({ ...filter, published: e.target.value === 'yes' ? 'yes' : e.target.value === 'no' ? 'no' : e.target.value === 'scheduled' ? 'scheduled' : 'all' }); }} data-testid="videos-published">
                <option value="all">Publicados y sin publicar</option>
                <option value="yes">Solo publicados</option>
                <option value="scheduled">Solo programados</option>
                <option value="no">Sin publicar</option>
              </select>
            </label>
          </div>
          <p className="muted" role="status" data-testid="videos-count">
            {shown.length === videos.length ? `${String(videos.length)} ${videos.length === 1 ? 'vídeo' : 'vídeos'}` : `${String(shown.length)} de ${String(videos.length)} vídeos`}
          </p>

          <div className="row vtools">
            <button type="button" className={selecting ? 'btn btn--primary' : 'btn'} aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setPicked(new Set()); }} data-testid="select-mode">
              <ListChecks aria-hidden="true" size={20} />
              {selecting ? 'Terminar selección' : 'Seleccionar'}
            </button>
            {selecting && (
              <>
                <button type="button" className="btn" onClick={() => { setPicked(new Set(shown.map((v) => v.id))); }} data-testid="select-all">
                  Seleccionar los {String(shown.length)} visibles
                </button>
                <button type="button" className="btn" disabled={picked.size === 0} onClick={() => { setToDelete([...picked]); }} data-testid="delete-selected">
                  <Trash2 aria-hidden="true" size={20} />
                  Eliminar ({String(picked.size)})
                </button>
              </>
            )}
          </div>

          {shown.length === 0 ? (
            <p className="muted" data-testid="videos-none">
              Ningún vídeo coincide con los filtros.
            </p>
          ) : (
            <ul className="vcards plain-list" data-testid="videos-list">
              {shown.map((v) => {
                const linked = pubs.filter((p) => p.videoId === v.id);
                const platforms = [...new Set(linked.map((p) => p.platform))];
                const isDownloaded = downloaded.has(v.match.id);
                const state = publishState(v.id, published, scheduled, now);
                const at = scheduled[v.id];
                return (
                  <li className="vcard card" key={v.id} data-testid="video-card">
                    <div className="vcard__main">
                      {selecting && (
                        <label className="vcard__pick">
                          <input
                            type="checkbox"
                            checked={picked.has(v.id)}
                            onChange={(e) => {
                              const next = new Set(picked);
                              if (e.target.checked) next.add(v.id);
                              else next.delete(v.id);
                              setPicked(next);
                            }}
                            data-testid="video-pick"
                          />
                          <span>Seleccionar <span className="visually-hidden">{v.match.home} vs {v.match.away}, semilla {v.seed}</span></span>
                        </label>
                      )}
                      <div className="vcard__score" aria-label={`Marcador ficticio ${String(v.score.home)} a ${String(v.score.away)}`}>
                        <strong>
                          {v.score.home}–{v.score.away}
                        </strong>
                        <span>ficticio</span>
                      </div>
                      <div className="vcard__info">
                        <div className="vcard__top">
                          <span className="chip chip--muted">{v.match.competition}</span>
                          {v.id in published && (
                            <span className="chip chip--done" data-testid="chip-published">
                              <CheckCheck aria-hidden="true" size={14} />
                              Publicado
                            </span>
                          )}
                          {(state === 'scheduled' || state === 'due') && at !== undefined && (
                            <span className={state === 'due' ? 'chip chip--warn' : 'chip chip--scheduled'} data-testid="chip-scheduled">
                              <CalendarClock aria-hidden="true" size={14} />
                              {state === 'due' ? 'Confirmar publicación' : 'Programado'} · {formatScheduled(at)}
                            </span>
                          )}
                          {isDownloaded && (
                            <span className="chip chip--done">
                              <Check aria-hidden="true" size={14} />
                              Descargado
                            </span>
                          )}
                        </div>
                        <h2 className="vcard__title">
                          <a href={videoHref(v.id)}>
                            {v.match.home} <span className="muted">vs</span> {v.match.away}
                          </a>
                        </h2>
                        <p className="muted">
                          {v.match.round} · {formatDateEs(kickoffOf(v.match).date)}
                        </p>
                        <p className="muted">
                          {styleLabel(v)} · {v.durationSeconds.toFixed(0)} s · {formatBytes(v.bytes)} · semilla {v.seed}
                        </p>
                      </div>
                    </div>
                    <div className="vcard__foot">
                      <div className="vcard__tags">
                        {platforms.length === 0 ? (
                          <span className="muted">{published[v.id] === undefined ? 'Sin publicar' : `Publicado el ${formatDateEs(published[v.id] ?? '')}`}</span>
                        ) : (
                          platforms.map((p) => (
                            <span key={p} className={`chip chip--${p}`}>
                              {platformLabel(p)}
                            </span>
                          ))
                        )}
                      </div>
                      <button type="button" className="btn" onClick={() => { setToDelete([v.id]); }} aria-label={`Eliminar ${v.match.home} vs ${v.match.away}, semilla ${String(v.seed)}`} data-testid="delete-video">
                        <Trash2 aria-hidden="true" size={20} />
                        Eliminar
                      </button>
                      <a className="btn btn--primary" href={videoHref(v.id)} data-testid="open-video">
                        Abrir ficha
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <ConfirmDialog
        open={toDelete !== null}
        title={(toDelete?.length ?? 0) === 1 ? 'Eliminar vídeo' : `Eliminar ${String(toDelete?.length ?? 0)} vídeos`}
        message="Se borran de la biblioteca junto con su marca de publicado o programado (no los archivos que ya descargaste). Podrás crear el mismo vídeo otra vez desde el estudio."
        confirmLabel="Eliminar"
        onCancel={() => { setToDelete(null); }}
        onConfirm={() => {
          removeVideos(toDelete ?? []);
          setPicked(new Set());
          setToDelete(null);
        }}
      />
    </div>
  );
}
