import { Calendar, Check, Film, Search } from 'lucide-react';
import { useState } from 'react';

import { videoHref } from '../../app/route.ts';
import { formatDateEs, kickoffOf } from '../../data/dates.ts';
import { useDownloaded } from '../../ui/useDownloaded.ts';
import { platformLabel } from '../stats/model.ts';
import { usePublications } from '../stats/store.ts';
import { filterVideos, formatBytes, type VideoFilter, type VideoRecord } from './model.ts';
import { useVideos } from './store.ts';
import './videos.css';

const styleLabel = (v: VideoRecord): string => (v.style === 'arena' ? 'Arena' : 'Táctico');

export function VideosView() {
  const videos = useVideos();
  const downloaded = useDownloaded();
  const pubs = usePublications();
  const [filter, setFilter] = useState<VideoFilter>({ text: '', competition: '', downloaded: 'all' });

  const competitions = [...new Set(videos.map((v) => v.match.competition))].sort((a, b) => a.localeCompare(b));
  const shown = filterVideos(videos, filter, downloaded);

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
          </div>
          <p className="muted" role="status" data-testid="videos-count">
            {shown.length === videos.length ? `${String(videos.length)} ${videos.length === 1 ? 'vídeo' : 'vídeos'}` : `${String(shown.length)} de ${String(videos.length)} vídeos`}
          </p>

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
                return (
                  <li className="vcard card" key={v.id} data-testid="video-card">
                    <div className="vcard__main">
                      <div className="vcard__score" aria-label={`Marcador ficticio ${String(v.score.home)} a ${String(v.score.away)}`}>
                        <strong>
                          {v.score.home}–{v.score.away}
                        </strong>
                        <span>ficticio</span>
                      </div>
                      <div className="vcard__info">
                        <div className="vcard__top">
                          <span className="chip chip--muted">{v.match.competition}</span>
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
                          <span className="muted">Sin publicar</span>
                        ) : (
                          platforms.map((p) => (
                            <span key={p} className={`chip chip--${p}`}>
                              {platformLabel(p)}
                            </span>
                          ))
                        )}
                      </div>
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
    </div>
  );
}
