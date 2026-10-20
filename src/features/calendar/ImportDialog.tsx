import { FileUp, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';

import type { ImportedProvider } from '../../data/imported.ts';
import type { League } from '../../data/types.ts';
import { DataError } from '../../data/types.ts';

interface Props {
  readonly open: boolean;
  readonly imported: ImportedProvider;
  readonly onClose: () => void;
  readonly onChanged: (league: League | null) => void;
}

export function ImportDialog({ open, imported, onClose, onChanged }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('Champions League');
  const [season, setSeason] = useState('2026-27');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [calendars, setCalendars] = useState<readonly League[]>(() => imported.listLeagues());

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (file === null) {
      setError('Elige un archivo .json o .txt');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const text = await file.text();
      const league = imported.importCalendar({ name, season, text });
      setCalendars(imported.listLeagues());
      setFile(null);
      onChanged(league);
      onClose();
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo leer el archivo');
    } finally {
      setBusy(false);
    }
  }

  function remove(league: League): void {
    try {
      imported.removeCalendar(league.id);
      setCalendars(imported.listLeagues());
      onChanged(null);
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo eliminar el calendario');
    }
  }

  return (
    <dialog ref={ref} className="dialog" aria-labelledby="import-title" onClose={onClose}>
      <form className="dialog__body" onSubmit={(e) => void onSubmit(e)}>
        <div className="dialog__head">
          <h2 id="import-title">Importar calendario</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        <p className="muted">
          Para competiciones que las fuentes libres aún no publican (p. ej. la Champions League 2026-27). El archivo se
          procesa en tu navegador y se guarda solo en él.
        </p>
        <details className="help">
          <summary>¿Dónde consigo el archivo?</summary>
          <ul>
            <li>
              <strong>football-data.org</strong> (clave gratuita): con tu clave, descarga{' '}
              <code>https://api.football-data.org/v4/competitions/CL/matches?season=2026</code> enviando la cabecera{' '}
              <code>X-Auth-Token</code> (por ejemplo con <code>curl</code>) y guarda el JSON.
            </li>
            <li>
              <strong>fixturedownload.com</strong>: feeds JSON gratuitos (<code>/feed/json/…</code>); la lista de
              competiciones está en su web.
            </li>
            <li>
              <strong>openfootball</strong>: archivos <code>.json</code> o <code>.txt</code> (Football.TXT) cuando
              publiquen la temporada.
            </li>
          </ul>
          <p className="muted">Las horas de football-data.org y fixturedownload.com vienen en UTC y se muestran en tu zona horaria.</p>
        </details>
        <label className="field">
          <span>Nombre</span>
          <input value={name} onChange={(e) => { setName(e.target.value); }} required maxLength={60} />
        </label>
        <label className="field">
          <span>Temporada</span>
          <input value={season} onChange={(e) => { setSeason(e.target.value); }} required maxLength={20} />
        </label>
        <label className="field">
          <span>Archivo (.json o .txt)</span>
          <input
            type="file"
            accept=".json,.txt,application/json,text/plain"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); }}
            data-testid="import-file"
          />
        </label>
        {error !== null && (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            <FileUp aria-hidden="true" size={18} />
            {busy ? 'Importando…' : 'Importar'}
          </button>
        </div>
        {calendars.length > 0 && (
          <section aria-label="Calendarios importados">
            <h3>Importados</h3>
            <ul className="plain-list">
              {calendars.map((league) => (
                <li key={league.id} className="imported-row">
                  <span>
                    {league.name} {league.season}
                  </span>
                  <button type="button" className="icon-btn" onClick={() => { remove(league); }} aria-label={`Eliminar ${league.name} ${league.season}`}>
                    <Trash2 aria-hidden="true" size={18} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </form>
    </dialog>
  );
}
