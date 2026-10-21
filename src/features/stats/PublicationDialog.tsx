import { useState, type SyntheticEvent } from 'react';

import { todayLocal } from '../../data/dates.ts';
import { Dialog } from '../../ui/Dialog.tsx';
import type { VideoRecord } from '../videos/model.ts';
import { parseCount } from './csv.ts';
import {
  MAX_TITLE,
  PLATFORMS,
  isIsoDate,
  latest,
  publicationId,
  urlProblem,
  type Measurement,
  type Platform,
  type Publication,
} from './model.ts';
import { addMeasurement, replacePublication, savePublication } from './store.ts';

const COUNTERS = [
  { key: 'views', label: 'Vistas', required: true },
  { key: 'likes', label: 'Me gusta', required: false },
  { key: 'comments', label: 'Comentarios', required: false },
  { key: 'shares', label: 'Compartidos', required: false },
  { key: 'saves', label: 'Guardados', required: false },
  { key: 'reach', label: 'Alcance (si lo da la plataforma)', required: false },
] as const;

type CounterKey = (typeof COUNTERS)[number]['key'];
type CounterText = Record<CounterKey, string>;

const emptyCounters = (): CounterText => ({ views: '', likes: '', comments: '', shares: '', saves: '', reach: '' });
const countersOf = (m: Measurement | null): CounterText =>
  m === null
    ? emptyCounters()
    : { views: String(m.views), likes: String(m.likes), comments: String(m.comments), shares: String(m.shares), saves: String(m.saves), reach: m.reach === null ? '' : String(m.reach) };

/** Convierte lo escrito en una medición, o devuelve el mensaje del primer error. */
function readMeasurement(date: string, text: CounterText): { ok: Measurement } | { error: string } {
  if (!isIsoDate(date)) return { error: 'Indica la fecha de la medición.' };
  const n: Partial<Record<CounterKey, number>> = {};
  for (const c of COUNTERS) {
    const raw = text[c.key].trim();
    if (raw === '' && !c.required) continue;
    const v = parseCount(raw);
    if (v === null) return { error: `«${c.label.replace(/ \(.*\)/, '')}» debe ser un número entero igual o mayor que 0.` };
    n[c.key] = v;
  }
  return { ok: { date, views: n.views ?? 0, likes: n.likes ?? 0, comments: n.comments ?? 0, shares: n.shares ?? 0, saves: n.saves ?? 0, reach: n.reach ?? null } };
}

function CounterInputs({ text, onChange }: { readonly text: CounterText; readonly onChange: (next: CounterText) => void }) {
  return (
    <div className="form-grid">
      {COUNTERS.map((c) => (
        <label className="field" key={c.key}>
          <span>{c.label}</span>
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            required={c.required}
            value={text[c.key]}
            onChange={(e) => { onChange({ ...text, [c.key]: e.target.value }); }}
            data-testid={`counter-${c.key}`}
          />
        </label>
      ))}
    </div>
  );
}

interface PublicationProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Para editar una publicación existente (sin tocar sus mediciones). */
  readonly publication?: Publication;
  /** Valores iniciales al crear (p. ej. desde la ficha de un vídeo). */
  readonly preset?: { readonly videoId?: string; readonly title?: string; readonly platform?: Platform; readonly publishedAt?: string };
  readonly videos: readonly VideoRecord[];
}

/** Alta (con su primera medición) o edición de una publicación de TikTok o Instagram. */
export function PublicationDialog(props: PublicationProps) {
  return (
    <Dialog open={props.open} onClose={props.onClose} title={props.publication === undefined ? 'Añadir publicación' : 'Editar publicación'} testId="publication-dialog">
      <PublicationForm {...props} />
    </Dialog>
  );
}

function PublicationForm({ onClose, publication, preset, videos }: PublicationProps) {
  const editing = publication !== undefined;
  const today = todayLocal();
  const [platform, setPlatform] = useState<Platform>(publication?.platform ?? preset?.platform ?? 'tiktok');
  const [url, setUrl] = useState(publication?.url ?? '');
  const [title, setTitle] = useState(publication?.title ?? preset?.title ?? '');
  const [publishedAt, setPublishedAt] = useState(publication?.publishedAt ?? preset?.publishedAt ?? today);
  const [videoId, setVideoId] = useState(publication?.videoId ?? preset?.videoId ?? '');
  const [date, setDate] = useState(today);
  const [counters, setCounters] = useState<CounterText>(emptyCounters);
  const [error, setError] = useState<string | null>(null);

  function pickVideo(id: string): void {
    setVideoId(id);
    const v = videos.find((x) => x.id === id);
    if (v !== undefined && title.trim() === '') setTitle(`${v.match.home} vs ${v.match.away} (${String(v.score.home)}–${String(v.score.away)} ficticio)`);
  }

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const cleanTitle = title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
    if (cleanTitle === '') {
      setError('Escribe un título o una descripción corta.');
      return;
    }
    const bad = urlProblem(platform, url);
    if (bad !== null) {
      setError(bad);
      return;
    }
    if (!isIsoDate(publishedAt)) {
      setError('Indica la fecha de publicación.');
      return;
    }
    let measurements: readonly Measurement[] = publication?.measurements ?? [];
    if (!editing) {
      const read = readMeasurement(date, counters);
      if ('error' in read) {
        setError(read.error);
        return;
      }
      if (read.ok.date < publishedAt) {
        setError('La medición no puede ser anterior a la fecha de publicación.');
        return;
      }
      measurements = [read.ok];
    }
    const next: Publication = {
      id: publicationId(platform, url, cleanTitle, publishedAt),
      platform,
      url: url.trim(),
      title: cleanTitle,
      publishedAt,
      videoId: videoId === '' ? null : videoId,
      measurements,
    };
    const problem = editing ? replacePublication(publication.id, next) : savePublication(next);
    if (problem !== null) {
      setError(problem);
      return;
    }
    onClose();
  }

  return (
    <form className="dialog__form" onSubmit={submit} noValidate>
      <div className="form-grid">
        <label className="field">
          <span>Plataforma</span>
          <select value={platform} onChange={(e) => { setPlatform(e.target.value === 'instagram' ? 'instagram' : 'tiktok'); }} data-testid="pub-platform">
            {PLATFORMS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Fecha de publicación</span>
          <input type="date" value={publishedAt} max={today} onChange={(e) => { setPublishedAt(e.target.value); }} data-testid="pub-date" />
        </label>
      </div>
      <label className="field">
        <span>Título o descripción corta</span>
        <input value={title} maxLength={MAX_TITLE} onChange={(e) => { setTitle(e.target.value); }} data-testid="pub-title" />
      </label>
      <label className="field">
        <span>Enlace a la publicación (opcional, evita duplicados)</span>
        <input type="url" inputMode="url" value={url} placeholder="https://…" onChange={(e) => { setUrl(e.target.value); }} data-testid="pub-url" />
      </label>
      <label className="field">
        <span>Vídeo de la biblioteca (opcional)</span>
        <select value={videoId} onChange={(e) => { pickVideo(e.target.value); }} data-testid="pub-video">
          <option value="">Ninguno</option>
          {videos.map((v) => (
            <option key={v.id} value={v.id}>
              {v.match.home} vs {v.match.away} · semilla {v.seed}
            </option>
          ))}
        </select>
      </label>

      {!editing && (
        <fieldset className="dialog__fieldset">
          <legend>Primera medición</legend>
          <p className="muted">Copia los números que te muestra la plataforma en este momento (son totales acumulados).</p>
          <label className="field">
            <span>Fecha de la medición</span>
            <input type="date" value={date} max={today} onChange={(e) => { setDate(e.target.value); }} data-testid="measure-date" />
          </label>
          <CounterInputs text={counters} onChange={setCounters} />
        </fieldset>
      )}

      {error !== null && (
        <p className="alert alert--error" role="alert" data-testid="pub-error">
          {error}
        </p>
      )}
      <div className="dialog__actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" className="btn btn--primary" data-testid="pub-save">
          {editing ? 'Guardar cambios' : 'Guardar publicación'}
        </button>
      </div>
    </form>
  );
}

interface MeasurementProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly publication: Publication | null;
}

/** Añade una nueva medición (foto de los contadores en una fecha) a una publicación existente. */
export function MeasurementDialog({ open, onClose, publication }: MeasurementProps) {
  return (
    <Dialog open={open && publication !== null} onClose={onClose} title="Nueva medición" testId="measurement-dialog">
      {publication !== null && <MeasurementForm key={publication.id} publication={publication} onClose={onClose} />}
    </Dialog>
  );
}

function MeasurementForm({ publication, onClose }: { readonly publication: Publication; readonly onClose: () => void }) {
  const today = todayLocal();
  const last = latest(publication);
  const [date, setDate] = useState(today);
  const [counters, setCounters] = useState<CounterText>(() => countersOf(last));
  const [error, setError] = useState<string | null>(null);

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const read = readMeasurement(date, counters);
    if ('error' in read) {
      setError(read.error);
      return;
    }
    if (read.ok.date < publication.publishedAt) {
      setError('La medición no puede ser anterior a la fecha de publicación.');
      return;
    }
    const problem = addMeasurement(publication.id, read.ok);
    if (problem !== null) {
      setError(problem);
      return;
    }
    onClose();
  }

  return (
    <form className="dialog__form" onSubmit={submit} noValidate>
      <p className="muted">
        <strong>{publication.title}</strong>
        <br />
        Los números parten de la última medición; actualízalos con los que muestra ahora la plataforma. Si ya hay una medición en esa fecha, se reemplaza.
      </p>
      <label className="field">
        <span>Fecha de la medición</span>
        <input type="date" value={date} max={today} onChange={(e) => { setDate(e.target.value); }} data-testid="measure-date" />
      </label>
      <CounterInputs text={counters} onChange={setCounters} />
      {error !== null && (
        <p className="alert alert--error" role="alert" data-testid="measure-error">
          {error}
        </p>
      )}
      <div className="dialog__actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" className="btn btn--primary" data-testid="measure-save">
          Guardar medición
        </button>
      </div>
    </form>
  );
}
