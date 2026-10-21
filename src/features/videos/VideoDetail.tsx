import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Copy, Download, Film, Plus, RefreshCw, RotateCw, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { setBusy } from '../../app/busy.ts';
import { hrefFor, navigate } from '../../app/route.ts';
import { markDownloaded } from '../../data/downloaded.ts';
import { formatDateEs, kickoffOf } from '../../data/dates.ts';
import { simulateFor } from '../simulation/simulateFor.ts';
import { ConfirmDialog } from '../../ui/ConfirmDialog.tsx';
import { useDownloaded } from '../../ui/useDownloaded.ts';
import { ExportError, classifyExportError } from '../export/errors.ts';
import { exportVideo } from '../export/exportVideo.ts';
import { downloadBlob, useExportSupport } from '../export/useExportSupport.ts';
import { EVENT_LABELS } from '../simulation/eventLabels.ts';
import { metaFor } from '../simulation/meta.ts';
import { SimulationPreview } from '../simulation/SimulationPreview.tsx';
import { useTeamCrests } from '../simulation/useTeamCrests.ts';
import { VIDEO_STYLES } from '../simulation/renderers.ts';
import '../simulation/studio.css';
import { PublicationDialog } from '../stats/PublicationDialog.tsx';
import { engagementOf, latest, platformLabel, totalsOf, type Platform } from '../stats/model.ts';
import { usePublications } from '../stats/store.ts';
import { formatBytes, formatStamp, type VideoRecord } from './model.ts';
import { descriptionFor, recommendTime } from './publish.ts';
import { recordExport } from './record.ts';
import { removeVideo, useVideos } from './store.ts';
import './videos.css';

type Tab = 'summary' | 'events' | 'stats' | 'publish';

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'summary', label: 'Resumen' },
  { id: 'events', label: 'Jugadas' },
  { id: 'stats', label: 'Métricas' },
  { id: 'publish', label: 'Publicar' },
];

type Job =
  | { readonly phase: 'idle' }
  | { readonly phase: 'running'; readonly ratio: number }
  | { readonly phase: 'done' }
  | { readonly phase: 'error'; readonly error: ExportError };

const int = new Intl.NumberFormat('es-ES');
const pct = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(1).replace('.', ',')} %`);

interface Props {
  readonly record: VideoRecord;
  readonly onOpenStudio: (record: VideoRecord) => void;
}

/** Ficha completa de un vídeo: reproductor, resumen, jugadas, rendimiento y publicación. */
export function VideoDetail({ record, onOpenStudio }: Props) {
  const videos = useVideos();
  const downloaded = useDownloaded();
  const pubs = usePublications();
  const support = useExportSupport();
  const [tab, setTab] = useState<Tab>('summary');
  const [seek, setSeek] = useState<{ t: number; nonce: number } | null>(null);
  const [job, setJob] = useState<Job>({ phase: 'idle' });
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const [platform, setPlatform] = useState<Platform>('tiktok');
  const [variant, setVariant] = useState(0);
  const caption = descriptionFor(record, platform, variant);
  const reco = recommendTime(record.match, pubs, platform);
  const abortRef = useRef<AbortController | null>(null);
  const crests = useTeamCrests(record.match.home, record.match.away);

  const sim = useMemo(
    () => simulateFor(record.style, { seed: record.seed, home: record.match.home, away: record.match.away, score: record.fixedScore, pace: record.pace }, record.options.bounce),
    [record.style, record.seed, record.match.home, record.match.away, record.fixedScore, record.pace, record.options.bounce],
  );
  const meta = useMemo(() => metaFor(record.match, record.options), [record.match, record.options]);
  const kickoff = kickoffOf(record.match);
  const mine = pubs.filter((p) => p.videoId === record.id);
  const siblings = videos.filter((v) => v.match.id === record.match.id);
  const at = siblings.findIndex((v) => v.id === record.id);
  const prev = at > 0 ? siblings[at - 1] : undefined;
  const next = at >= 0 ? siblings[at + 1] : undefined;
  const engineChanged = sim.script.score.home !== record.score.home || sim.script.score.away !== record.score.away;
  const running = job.phase === 'running';

  useEffect(() => {
    setBusy('video-detail', running);
    return () => { setBusy('video-detail', false); };
  }, [running]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  async function download(): Promise<void> {
    const controller = new AbortController();
    abortRef.current = controller;
    setJob({ phase: 'running', ratio: 0 });
    let lastPaint = 0;
    try {
      const result = await exportVideo({
        sim,
        meta,
        style: record.style,
        title: `Simulación ficticia: ${record.match.home} vs ${record.match.away}`,
        signal: controller.signal,
        onProgress: (p) => {
          const now = performance.now();
          if (p.ratio >= 1 || now - lastPaint > 120) {
            lastPaint = now;
            setJob({ phase: 'running', ratio: p.ratio });
          }
        },
      });
      downloadBlob(result.blob, record.fileName);
      markDownloaded(record.match.id);
      recordExport({ match: record.match, seed: record.seed, style: record.style, pace: record.pace, fixedScore: record.fixedScore, score: record.score, options: record.options }, result, record.fileName);
      setJob({ phase: 'done' });
    } catch (error) {
      setJob({ phase: 'error', error: classifyExportError(error) });
    }
  }

  async function copyCaption(): Promise<void> {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied('ok');
    } catch (error) {
      console.warn('No se pudo copiar al portapapeles', error);
      setCopied('fail');
    }
  }

  const facts: readonly (readonly [string, string])[] = [
    ['Marcador ficticio', `${String(record.score.home)}–${String(record.score.away)}${record.fixedScore === null ? (record.style === 'arena' ? ' (salió de la física del partido)' : ' (lo decidió la semilla)') : ' (fijado por ti)'}`],
    ...(record.match.realScore === null ? [] : [['Resultado real (dato)', `${String(record.match.realScore.home)}–${String(record.match.realScore.away)}`] as const]),
    ['Semilla', String(record.seed)],
    ['Estilo y ritmo', `${VIDEO_STYLES.find((s) => s.id === record.style)?.label ?? record.style} · ${record.pace === 'fast' ? 'rápido' : 'normal'}`],
    ['Duración y tamaño', `${record.durationSeconds.toFixed(1)} s · ${formatBytes(record.bytes)}`],
    ['Última exportación', formatStamp(record.createdAt)],
    ['Archivo', record.fileName],
  ];

  return (
    <div className="vd" data-testid="video-detail">
      <nav className="crumbs" aria-label="Ruta">
        <a href={hrefFor({ view: 'videos', videoId: null })}>
          <ArrowLeft aria-hidden="true" size={18} />
          Vídeos
        </a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">
          {record.match.home} vs {record.match.away}
        </span>
      </nav>

      <header className="vd__head">
        <div>
          <span className="badge">Simulación ficticia</span>
          <h1>
            {record.match.home} <span className="muted">vs</span> {record.match.away}
          </h1>
          <p className="muted">
            {record.match.competition} · {record.match.round} · {formatDateEs(kickoff.date)}
            {kickoff.time !== null && ` · ${kickoff.time}`}
          </p>
        </div>
        {siblings.length > 1 && (
          <div className="pager" role="group" aria-label={`Vídeos de este partido (${String(at + 1)} de ${String(siblings.length)})`}>
            <button type="button" className="btn" disabled={prev === undefined} onClick={() => { if (prev !== undefined) navigate({ view: 'videos', videoId: prev.id }); }} aria-label="Vídeo anterior de este partido" data-testid="video-prev">
              <ChevronLeft aria-hidden="true" size={20} />
            </button>
            <span className="muted">
              {at + 1} de {siblings.length}
            </span>
            <button type="button" className="btn" disabled={next === undefined} onClick={() => { if (next !== undefined) navigate({ view: 'videos', videoId: next.id }); }} aria-label="Vídeo siguiente de este partido" data-testid="video-next">
              <ChevronRight aria-hidden="true" size={20} />
            </button>
          </div>
        )}
      </header>

      <div className="vd__grid">
        <section className="vd__preview" aria-label="Vista previa">
          <SimulationPreview
            key={record.id}
            sim={sim}
            crestVersion={crests.version}
            meta={meta}
            label={`Vista previa de la simulación ficticia de ${record.match.home} contra ${record.match.away}`}
            style={record.style}
            seek={seek}
          />
        </section>

        <div className="vd__body stack">
          {engineChanged && (
            <p className="alert alert--error" role="alert" data-testid="engine-changed">
              <AlertTriangle aria-hidden="true" size={20} />
              <span>Esta ficha se creó con una versión anterior del simulador: el vídeo que se regenere no coincidirá con el que descargaste ({record.score.home}–{record.score.away}).</span>
            </p>
          )}

          <div className="actions" role="group" aria-label="Acciones del vídeo">
            {!running && (
              <button type="button" className="btn btn--primary" onClick={() => void download()} disabled={support.state !== 'ok'} data-testid="detail-download">
                <Download aria-hidden="true" size={20} />
                {job.phase === 'done' ? 'Descargar de nuevo' : 'Descargar MP4'}
              </button>
            )}
            <button type="button" className="btn" onClick={() => { onOpenStudio(record); }} data-testid="detail-studio">
              <Film aria-hidden="true" size={20} />
              Abrir en el estudio
            </button>
            <button type="button" className="btn" onClick={() => { setDeleting(true); }} data-testid="detail-delete">
              <Trash2 aria-hidden="true" size={20} />
              Eliminar ficha
            </button>
          </div>
          {support.state === 'no' && (
            <p className="alert alert--error" role="alert">
              <AlertTriangle aria-hidden="true" size={20} />
              <span>{support.error.message}</span>
            </p>
          )}
          {job.phase === 'running' && (
            <div className="export__progress" role="status" data-testid="detail-progress">
              <progress max={1} value={job.ratio} aria-label="Progreso de la exportación" />
              <p>Generando el MP4 con los mismos parámetros… {Math.round(job.ratio * 100)} %</p>
              <button type="button" className="btn" onClick={() => { abortRef.current?.abort(); }}>
                <X aria-hidden="true" size={18} />
                Cancelar
              </button>
            </div>
          )}
          {job.phase === 'error' && (
            <div className="alert alert--error" role="alert">
              <AlertTriangle aria-hidden="true" size={20} />
              <div>
                <p>
                  <strong>{job.error.kind === 'cancelled' ? 'Exportación cancelada.' : 'La exportación falló.'}</strong> {job.error.kind === 'cancelled' ? '' : job.error.message}
                </p>
                {job.error.kind !== 'unsupported-browser' && job.error.kind !== 'codec-unsupported' && (
                  <button type="button" className="btn" onClick={() => void download()}>
                    <RotateCw aria-hidden="true" size={18} />
                    Reintentar
                  </button>
                )}
              </div>
            </div>
          )}
          {job.phase === 'done' && (
            <p className="notice notice--soft" role="status">
              Descarga lista: {record.fileName}
            </p>
          )}

          <div className="tabs" role="tablist" aria-label="Secciones de la ficha">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" id={`vd-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="vd-panel" onClick={() => { setTab(t.id); }} data-testid={`vd-tab-${t.id}`}>
                {t.label}
              </button>
            ))}
          </div>

          <div id="vd-panel" role="tabpanel" aria-labelledby={`vd-tab-${tab}`} className="stack">
            {tab === 'summary' && (
              <>
                <dl className="facts card">
                  {facts.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                  <div>
                    <dt>Descarga</dt>
                    <dd>{downloaded.has(record.match.id) ? 'Ya descargado' : 'Sin descargar'}</dd>
                  </div>
                </dl>
                <div className="card">
                  <h2>Estadísticas ficticias</h2>
                  <table className="stats">
                    <caption className="visually-hidden">Estadísticas ficticias de la simulación</caption>
                    <thead>
                      <tr>
                        <th scope="col">
                          <span className="visually-hidden">Estadística</span>
                        </th>
                        <th scope="col">{sim.script.teams.home.style.abbr}</th>
                        <th scope="col">{sim.script.teams.away.style.abbr}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(record.style === 'tactical' ? (['shots', 'onTarget', 'corners', 'fouls'] as const) : (['shots', 'onTarget'] as const)).map((key) => (
                        <tr key={key}>
                          <th scope="row">{{ shots: 'Tiros', onTarget: 'A puerta', corners: 'Córners', fouls: 'Faltas' }[key]}</th>
                          <td>{sim.script.stats.home[key]}</td>
                          <td>{sim.script.stats.away[key]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="muted">El MP4 no se guarda en el navegador (pesa decenas de MB): se vuelve a generar al pulsar «Descargar MP4» y sale idéntico, porque el simulador es determinista.</p>
              </>
            )}

            {tab === 'events' && (
              <div className="card">
                <h2>Jugadas</h2>
                <p className="muted">Pulsa una jugada para verla en el reproductor.</p>
                <ol className="events plain-list" data-testid="vd-events">
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
            )}

            {tab === 'stats' && (
              <div className="card" data-testid="vd-performance">
                <h2>Rendimiento en redes</h2>
                {mine.length === 0 ? (
                  <p className="muted">Aún no has registrado ninguna publicación de este vídeo. Cuando lo subas a TikTok o Instagram, añade su enlace y los números que te muestra la plataforma.</p>
                ) : (
                  <>
                    <p>
                      <strong>{int.format(totalsOf(mine).views)}</strong> vistas · <strong>{int.format(totalsOf(mine).likes)}</strong> me gusta · interacción {pct(totalsOf(mine).engagement)}
                    </p>
                    <ul className="plain-list stack">
                      {mine.map((p) => {
                        const m = latest(p);
                        return (
                          <li key={p.id} className="publine">
                            <span className={`chip chip--${p.platform}`}>{platformLabel(p.platform)}</span>
                            <span className="publine__title">{p.title}</span>
                            <span className="muted">
                              {m === null ? 'Sin mediciones' : `${int.format(m.views)} vistas · ${pct(engagementOf(m))} · medido el ${m.date}`}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
                <div className="row">
                  <button type="button" className="btn btn--primary" onClick={() => { setAdding(true); }} data-testid="detail-add-publication">
                    <Plus aria-hidden="true" size={20} />
                    Añadir publicación de este vídeo
                  </button>
                  <a className="btn" href={hrefFor({ view: 'stats' })}>
                    Ver todas las estadísticas
                  </a>
                </div>
              </div>
            )}

            {tab === 'publish' && (
              <div className="card">
                <h2>Descripción para publicar</h2>
                <div className="segmented" role="group" aria-label="Plataforma">
                  {(['tiktok', 'instagram'] as const).map((pl) => (
                    <button key={pl} type="button" className="segmented__btn" aria-pressed={platform === pl} onClick={() => { setPlatform(pl); setCopied(null); }}>
                      {platformLabel(pl)}
                    </button>
                  ))}
                </div>
                <label className="field">
                  <span>Texto con 5 hashtags para {platformLabel(platform)} (puedes editarlo al pegarlo)</span>
                  <textarea className="textarea" readOnly rows={7} value={caption} data-testid="caption" />
                </label>
                <p className="muted">Los hashtags son los del partido y los habituales del fútbol: no se puede medir cuál se hará viral.</p>
                <div className="row">
                  <button type="button" className="btn btn--primary" onClick={() => void copyCaption()} data-testid="copy-caption">
                    <Copy aria-hidden="true" size={20} />
                    Copiar descripción
                  </button>
                  <button type="button" className="btn" onClick={() => { setVariant((v) => v + 1); setCopied(null); }} data-testid="next-variant">
                    <RefreshCw aria-hidden="true" size={20} />
                    Otra versión
                  </button>
                </div>
                {copied === 'ok' && (
                  <p className="notice notice--soft" role="status">
                    Descripción copiada.
                  </p>
                )}
                {copied === 'fail' && (
                  <p className="alert alert--error" role="alert">
                    No se pudo copiar automáticamente. Selecciona el texto y cópialo a mano.
                  </p>
                )}
                <div className="notice notice--soft" data-testid="time-reco">
                  <strong>Hora recomendada para publicar: {reco.headline}</strong>
                  <p>{reco.detail}</p>
                </div>
                <ul className="checklist">
                  <li>La publicación en TikTok o Instagram es manual: descarga el MP4 y súbelo tú.</li>
                  <li>Es una simulación ficticia, no una predicción. Revisa si la plataforma te pide etiquetar el contenido como generado o simulado.</li>
                  <li>Después de publicar, vuelve a «Rendimiento» y guarda el enlace para seguir sus números.</li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      <PublicationDialog
        open={adding}
        onClose={() => { setAdding(false); }}
        videos={videos}
        preset={{ videoId: record.id, title: `${record.match.home} vs ${record.match.away} (${String(record.score.home)}–${String(record.score.away)} ficticio)` }}
      />
      <ConfirmDialog
        open={deleting}
        title="Eliminar ficha"
        message="Se borra la ficha de la biblioteca (no el archivo que ya descargaste). Podrás crear el mismo vídeo otra vez desde el estudio."
        confirmLabel="Eliminar"
        onCancel={() => { setDeleting(false); }}
        onConfirm={() => {
          setDeleting(false);
          removeVideo(record.id);
          navigate({ view: 'videos', videoId: null });
        }}
      />
    </div>
  );
}
