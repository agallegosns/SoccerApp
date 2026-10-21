import { BarChart3, Download, FileUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { useId, useState, type ChangeEvent } from 'react';

import { ConfirmDialog } from '../../ui/ConfirmDialog.tsx';
import { downloadText } from '../../ui/download.ts';
import { LineChart } from '../../ui/LineChart.tsx';
import { useVideos } from '../videos/store.ts';
import { CSV_EXAMPLE, parseStatsCsv, statsToCsv, type CsvResult } from './csv.ts';
import { ConnectionCard, SyncStrip } from './ConnectionCard.tsx';
import { MeasurementDialog, PublicationDialog } from './PublicationDialog.tsx';
import {
  PLATFORMS,
  engagementOf,
  latest,
  platformLabel,
  rankPublications,
  timelineOf,
  totalsOf,
  type Platform,
  type Publication,
  type SortKey,
} from './model.ts';
import { importPublications, removePublication, usePublications } from './store.ts';
import './stats.css';

type Tab = 'summary' | 'list' | 'data';
type PlatformFilter = 'all' | Platform;

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'summary', label: 'Resumen' },
  { id: 'list', label: 'Publicaciones' },
  { id: 'data', label: 'Conexión' },
];

const int = new Intl.NumberFormat('es-ES');
const pct = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(1).replace('.', ',')} %`);

interface Props {
  readonly onOpenVideo: (videoId: string) => void;
}

export function StatsView({ onOpenVideo }: Props) {
  const all = usePublications();
  const videos = useVideos();
  const [tab, setTab] = useState<Tab>('summary');
  const [platform, setPlatform] = useState<PlatformFilter>('all');
  const [sort, setSort] = useState<SortKey>('views');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Publication | null>(null);
  const [measuring, setMeasuring] = useState<Publication | null>(null);
  const [deleting, setDeleting] = useState<Publication | null>(null);
  const [report, setReport] = useState<(CsvResult & { fileName: string; saved: string | null }) | null>(null);
  const fileId = useId();

  const pubs = platform === 'all' ? all : all.filter((p) => p.platform === platform);
  const totals = totalsOf(pubs);
  const timeline = timelineOf(pubs);
  const ranked = rankPublications(pubs, sort);

  async function onFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    if (file.size > 5_000_000) {
      setReport({ publications: [], rows: 0, issues: [{ line: 0, message: 'El archivo pesa más de 5 MB: no parece un CSV de estadísticas.' }], fileName: file.name, saved: null });
      return;
    }
    const result = parseStatsCsv(await file.text());
    const saved = result.publications.length > 0 ? importPublications(result.publications) : null;
    setReport({ ...result, fileName: file.name, saved });
  }

  const tiles: readonly { readonly label: string; readonly value: string }[] = [
    { label: 'Vistas', value: int.format(totals.views) },
    { label: 'Me gusta', value: int.format(totals.likes) },
    { label: 'Comentarios', value: int.format(totals.comments) },
    { label: 'Compartidos', value: int.format(totals.shares) },
    { label: 'Guardados', value: int.format(totals.saves) },
    { label: 'Interacción', value: pct(totals.engagement) },
  ];

  return (
    <div className="stats-view" data-testid="stats-view">
      <header className="section-head">
        <div>
          <h1>Estadísticas</h1>
          <p className="muted intro">Cómo rinden tus vídeos en TikTok e Instagram. Son datos reales de tus publicaciones, separados de la simulación.</p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => { setAdding(true); }} data-testid="add-publication">
          <Plus aria-hidden="true" size={20} />
          Añadir publicación
        </button>
      </header>

      <SyncStrip onSetup={() => { setTab('data'); }} />

      <div className="tabs" role="tablist" aria-label="Secciones de estadísticas">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`stats-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="stats-panel" onClick={() => { setTab(t.id); }} data-testid={`stats-tab-${t.id}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab !== 'data' && (
        <div className="segmented" role="group" aria-label="Plataforma">
          <button type="button" aria-pressed={platform === 'all'} onClick={() => { setPlatform('all'); }}>
            Todas
          </button>
          {PLATFORMS.map((p) => (
            <button key={p.id} type="button" aria-pressed={platform === p.id} onClick={() => { setPlatform(p.id); }} data-testid={`platform-${p.id}`}>
              {p.label}
            </button>
          ))}
        </div>
      )}

      <div id="stats-panel" role="tabpanel" aria-labelledby={`stats-tab-${tab}`} className="stack">
        {tab === 'summary' && (
          <>
            {all.length === 0 ? (
              <div className="empty" data-testid="stats-empty">
                <BarChart3 aria-hidden="true" size={32} />
                <h2>Aún no hay estadísticas</h2>
                <p className="muted">Añade una publicación con los números que te muestra TikTok o Instagram, o importa un CSV desde «Datos y conexión».</p>
              </div>
            ) : pubs.length === 0 ? (
              <p className="muted">No hay publicaciones de {platform === 'all' ? 'ninguna plataforma' : platformLabel(platform)}.</p>
            ) : (
              <>
                <ul className="tiles plain-list" data-testid="stats-tiles">
                  {tiles.map((t) => (
                    <li className="tile" key={t.label}>
                      <span className="tile__label">{t.label}</span>
                      <strong className="tile__value">{t.value}</strong>
                    </li>
                  ))}
                </ul>
                <p className="muted">
                  Suma de la última medición de {totals.publications} {totals.publications === 1 ? 'publicación' : 'publicaciones'}.
                  {totals.reach !== null && ` Alcance declarado: ${int.format(totals.reach)}.`}
                </p>

                {platform === 'all' && (
                  <div className="card">
                    <h2>Vistas por plataforma</h2>
                    <ul className="bars plain-list">
                      {PLATFORMS.map((p) => {
                        const v = totalsOf(all.filter((x) => x.platform === p.id)).views;
                        const max = Math.max(1, ...PLATFORMS.map((q) => totalsOf(all.filter((x) => x.platform === q.id)).views));
                        return (
                          <li key={p.id} className="bar">
                            <span className="bar__label">{p.label}</span>
                            <span className="bar__track" aria-hidden="true">
                              <span className="bar__fill" style={{ width: `${String((v / max) * 100)}%` }} />
                            </span>
                            <span className="bar__value">{int.format(v)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                <div className="card">
                  <h2>Evolución de las vistas</h2>
                  {timeline.length < 2 ? (
                    <p className="muted">Hacen falta mediciones de al menos dos fechas distintas para dibujar la evolución. Usa «Nueva medición» en cada publicación cuando quieras actualizar sus números.</p>
                  ) : (
                    <LineChart points={timeline.map((p) => ({ label: p.date, value: p.views }))} label={`Evolución de las vistas totales entre el ${timeline[0]?.date ?? ''} y el ${timeline[timeline.length - 1]?.date ?? ''}`} format={(n) => int.format(n)} />
                  )}
                </div>

                <div className="card">
                  <h2>Mejores publicaciones</h2>
                  <ol className="ranking plain-list">
                    {rankPublications(pubs, 'views')
                      .slice(0, 5)
                      .map((p, i) => (
                        <li key={p.id}>
                          <span className="ranking__pos">{i + 1}</span>
                          <span className="ranking__title">
                            {p.title}
                            <span className="muted"> · {platformLabel(p.platform)}</span>
                          </span>
                          <strong>{int.format(latest(p)?.views ?? 0)}</strong>
                        </li>
                      ))}
                  </ol>
                </div>
              </>
            )}
          </>
        )}

        {tab === 'list' && (
          <>
            <label className="field field--inline">
              <span>Ordenar por</span>
              <select value={sort} onChange={(e) => { setSort(e.target.value as SortKey); }} data-testid="stats-sort">
                <option value="views">Más vistas</option>
                <option value="likes">Más me gusta</option>
                <option value="engagement">Mayor interacción</option>
                <option value="recent">Más recientes</option>
              </select>
            </label>
            {ranked.length === 0 && <p className="muted" data-testid="stats-list-empty">No hay publicaciones todavía.</p>}
            <ul className="pubs plain-list" data-testid="stats-list">
              {ranked.map((p) => {
                const m = latest(p);
                const video = p.videoId === null ? undefined : videos.find((v) => v.id === p.videoId);
                return (
                  <li className="pub card" key={p.id} data-testid="publication">
                    <div className="pub__head">
                      <span className={`chip chip--${p.platform}`}>{platformLabel(p.platform)}</span>
                      <h3>{p.title}</h3>
                    </div>
                    <p className="muted">
                      Publicado el {p.publishedAt}
                      {m !== null && ` · última medición ${m.date}`}
                    </p>
                    {m === null ? (
                      <p className="muted">Sin mediciones.</p>
                    ) : (
                      <dl className="metrics">
                        {[
                          ['Vistas', int.format(m.views)],
                          ['Me gusta', int.format(m.likes)],
                          ['Comentarios', int.format(m.comments)],
                          ['Compartidos', int.format(m.shares)],
                          ['Guardados', int.format(m.saves)],
                          ['Interacción', pct(engagementOf(m))],
                        ].map(([k, v]) => (
                          <div key={k}>
                            <dt>{k}</dt>
                            <dd>{v}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <div className="row">
                      <button type="button" className="btn btn--small btn--primary" onClick={() => { setMeasuring(p); }} data-testid="new-measurement">
                        <Plus aria-hidden="true" size={16} />
                        Nueva medición
                      </button>
                      <button type="button" className="btn btn--small" onClick={() => { setEditing(p); }}>
                        <Pencil aria-hidden="true" size={16} />
                        Editar
                      </button>
                      {p.url !== '' && (
                        <a className="btn btn--small" href={p.url} target="_blank" rel="noreferrer noopener">
                          Abrir enlace
                        </a>
                      )}
                      {video !== undefined && (
                        <button type="button" className="btn btn--small" onClick={() => { onOpenVideo(video.id); }}>
                          Ver ficha del vídeo
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => { setDeleting(p); }}
                        data-testid="delete-publication"
                      >
                        <Trash2 aria-hidden="true" size={16} />
                        Eliminar
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {tab === 'data' && (
          <>
            <ConnectionCard />
            <div className="card">
              <h2>Importar y exportar (CSV)</h2>
              <p className="muted">
                Un CSV con una fila por medición. Las filas con el mismo enlace se agrupan en una publicación y, si importas el mismo archivo dos veces, no se duplica nada. Los datos se guardan solo en este navegador.
              </p>
              <div className="row">
                <label className="btn btn--primary" htmlFor={fileId}>
                  <FileUp aria-hidden="true" size={20} />
                  Importar CSV
                </label>
                <input id={fileId} className="visually-hidden" type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void onFile(e)} data-testid="stats-file" />
                <button type="button" className="btn" disabled={all.length === 0} onClick={() => { downloadText(statsToCsv(all), 'estadisticas-futbol-sim.csv', 'text/csv;charset=utf-8'); }} data-testid="stats-export">
                  <Download aria-hidden="true" size={20} />
                  Exportar CSV
                </button>
                <button type="button" className="btn" onClick={() => { downloadText(`${CSV_EXAMPLE}\n`, 'plantilla-estadisticas.csv', 'text/csv;charset=utf-8'); }}>
                  Descargar plantilla
                </button>
              </div>
              {report !== null && (
                <div className={report.issues.length > 0 ? 'alert alert--error' : 'notice'} role="status" data-testid="stats-report">
                  <div>
                    <p>
                      <strong>{report.fileName}</strong>: {report.rows} {report.rows === 1 ? 'fila importada' : 'filas importadas'}
                      {report.issues.length > 0 && `, ${String(report.issues.length)} con problemas`}.
                    </p>
                    {report.saved !== null && <p>{report.saved}</p>}
                    {report.issues.length > 0 && (
                      <ul>
                        {report.issues.slice(0, 8).map((i) => (
                          <li key={`${String(i.line)}-${i.message}`}>
                            {i.line > 0 ? `Línea ${String(i.line)}: ` : ''}
                            {i.message}
                          </li>
                        ))}
                        {report.issues.length > 8 && <li>…y {report.issues.length - 8} más.</li>}
                      </ul>
                    )}
                  </div>
                </div>
              )}
              <details className="help">
                <summary>Formato del CSV</summary>
                <ul>
                  <li>
                    Columnas: <code>plataforma, url, titulo, publicado, fecha_medicion, vistas, likes, comentarios, compartidos, guardados, alcance</code>.
                  </li>
                  <li>Obligatorias: plataforma (tiktok o instagram), fecha_medicion, vistas y, para identificar la publicación, url o titulo.</li>
                  <li>Fechas como AAAA-MM-DD o DD/MM/AAAA. Separador coma, punto y coma o tabulador. También se reconocen cabeceras en inglés (platform, views, likes…).</li>
                  <li>Los contadores son totales acumulados en esa fecha, no incrementos.</li>
                </ul>
              </details>
            </div>

          </>
        )}
      </div>

      <PublicationDialog open={adding} onClose={() => { setAdding(false); }} videos={videos} />
      <PublicationDialog open={editing !== null} onClose={() => { setEditing(null); }} publication={editing ?? undefined} videos={videos} />
      <MeasurementDialog open={measuring !== null} onClose={() => { setMeasuring(null); }} publication={measuring} />
      <ConfirmDialog
        open={deleting !== null}
        title="Eliminar publicación"
        message={`¿Eliminar «${deleting?.title ?? ''}» y todas sus mediciones? No se puede deshacer.`}
        confirmLabel="Eliminar"
        onCancel={() => { setDeleting(null); }}
        onConfirm={() => {
          if (deleting !== null) removePublication(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
