import { CheckCircle2, CircleAlert, Link2Off, RefreshCw, Wifi } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';

import { clearSyncConfig, cleanUrl, configProblem, readSyncConfig, runSync, saveSyncConfig, type SourceState } from './sync.ts';
import { ago, useSyncState } from './useSync.ts';

const SOURCE_TEXT: Readonly<Record<SourceState, string>> = {
  ok: 'Conectada',
  'sin-configurar': 'Sin configurar en el Worker',
  'sin-autorizar': 'Falta autorizar la cuenta',
  error: 'Error al consultarla',
};

/** Conexión con el Worker que recoge las estadísticas automáticamente (cada 30 minutos). */
export function ConnectionCard() {
  const sync = useSyncState();
  const saved = readSyncConfig();
  const [url, setUrl] = useState(saved?.url ?? '');
  const [key, setKey] = useState(saved?.key ?? '');
  const [error, setError] = useState<string | null>(null);
  const connected = sync.status !== 'off';

  function connect(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const problem = configProblem(url, key);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      saveSyncConfig({ url: cleanUrl(url), key });
    } catch (cause) {
      console.warn('No se pudo guardar la conexión', cause);
      setError('No se pudo guardar la conexión en este navegador.');
      return;
    }
    void runSync();
  }

  return (
    <div className="card" data-testid="stats-connection">
      <div className="section-head">
        <h2>Actualización automática</h2>
        {connected && (
          <span className={`chip ${sync.status === 'error' ? 'chip--muted' : 'chip--real'}`} data-testid="sync-chip">
            {sync.status === 'syncing' ? 'Actualizando…' : sync.status === 'error' ? 'Con problemas' : 'Activa'}
          </span>
        )}
      </div>
      <p className="muted">
        Un Worker gratuito de Cloudflare consulta tus cuentas de Instagram y TikTok cada 30 minutos con sus APIs oficiales, y esta app lo lee al abrirse y cada 30 minutos mientras está abierta. Los pasos para crearlo están en{' '}
        <code>docs/ESTADISTICAS-AUTOMATICAS.md</code>.
      </p>

      <form className="stack" onSubmit={connect} noValidate>
        <label className="field">
          <span>Dirección del Worker</span>
          <input type="url" inputMode="url" placeholder="https://futbol-stats.tu-usuario.workers.dev" value={url} onChange={(e) => { setUrl(e.target.value); }} data-testid="sync-url" autoComplete="off" />
        </label>
        <label className="field">
          <span>Clave de lectura (STATS_KEY)</span>
          <input type="password" value={key} onChange={(e) => { setKey(e.target.value); }} data-testid="sync-key" autoComplete="off" />
        </label>
        {error !== null && (
          <p className="alert alert--error" role="alert" data-testid="sync-form-error">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn btn--primary" data-testid="sync-save">
            <Wifi aria-hidden="true" size={20} />
            {connected ? 'Guardar y actualizar' : 'Conectar'}
          </button>
          {connected && (
            <>
              <button type="button" className="btn" onClick={() => { void runSync(); }} disabled={sync.status === 'syncing'} data-testid="sync-now">
                <RefreshCw aria-hidden="true" size={20} />
                Actualizar ahora
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  clearSyncConfig();
                  setUrl('');
                  setKey('');
                }}
                data-testid="sync-disconnect"
              >
                <Link2Off aria-hidden="true" size={20} />
                Desconectar
              </button>
            </>
          )}
        </div>
      </form>

      {connected && (
        <div className="stack" data-testid="sync-status">
          {sync.status === 'error' && sync.message !== null && (
            <p className="alert alert--error" role="alert" data-testid="sync-error">
              <CircleAlert aria-hidden="true" size={20} />
              {sync.message}
            </p>
          )}
          {sync.snapshotAt !== null && (
            <p>
              <CheckCircle2 aria-hidden="true" size={18} className="inline-icon" /> Datos recogidos por el Worker <strong>{ago(sync.snapshotAt)}</strong>
              {sync.changed > 0 && <> · {String(sync.changed)} publicaciones actualizadas</>}.
            </p>
          )}
          {sync.sources !== null && (
            <ul className="sync-sources">
              <li>
                <strong>Instagram</strong>: {SOURCE_TEXT[sync.sources.instagram.state]}
                {sync.sources.instagram.message !== null && <span className="muted"> — {sync.sources.instagram.message}</span>}
              </li>
              <li>
                <strong>TikTok</strong>: {SOURCE_TEXT[sync.sources.tiktok.state]}
                {sync.sources.tiktok.message !== null && <span className="muted"> — {sync.sources.tiktok.message}</span>}
              </li>
            </ul>
          )}
        </div>
      )}

      <details className="help">
        <summary>Qué datos llegan y cuáles no</summary>
        <ul>
          <li>
            <strong>Instagram</strong>: vistas, alcance, me gusta, comentarios, compartidos y guardados (cuenta profesional). Meta puede tardar hasta 48 h en consolidar algunas cifras.
          </li>
          <li>
            <strong>TikTok</strong>: vistas, me gusta, comentarios y compartidos. La API no da «guardados» ni «alcance»: esos campos se quedan como estén (los que escribas a mano se conservan).
          </li>
          <li>Se consultan las 20 publicaciones más recientes de cada plataforma. Cada día se guarda una medición, así que el gráfico muestra la evolución diaria.</li>
          <li>Las publicaciones se identifican por su enlace: si ya tenías una escrita a mano con ese mismo enlace, se actualiza en vez de duplicarse.</li>
        </ul>
      </details>
    </div>
  );
}

/** Franja de estado en lo alto de Estadísticas: muestra si los datos se actualizan solos y cuándo fue la última vez. */
export function SyncStrip({ onSetup }: { readonly onSetup: () => void }) {
  const sync = useSyncState();
  if (sync.status === 'off') {
    return (
      <div className="sync-strip" data-testid="sync-strip">
        <p>
          <strong>Estadísticas manuales.</strong> Conecta tus cuentas para que se actualicen solas cada 30 min.
        </p>
        <button type="button" className="btn" onClick={onSetup} data-testid="sync-setup">
          <Wifi aria-hidden="true" size={20} />
          Activar automático
        </button>
      </div>
    );
  }
  return (
    <div className="sync-strip" data-testid="sync-strip" data-status={sync.status}>
      <p>
        {sync.status === 'error' ? (
          <>
            <CircleAlert aria-hidden="true" size={18} className="inline-icon" /> <strong>No se pudo actualizar.</strong> {sync.message}
          </>
        ) : (
          <>
            <CheckCircle2 aria-hidden="true" size={18} className="inline-icon" /> <strong>Actualización automática activa.</strong>{' '}
            {sync.status === 'syncing' ? 'Actualizando…' : sync.snapshotAt === null ? 'Esperando datos…' : `Última recogida ${ago(sync.snapshotAt)}.`}
          </>
        )}
      </p>
      <button type="button" className="btn" onClick={() => { void runSync(); }} disabled={sync.status === 'syncing'} data-testid="sync-strip-now">
        <RefreshCw aria-hidden="true" size={20} />
        Actualizar
      </button>
    </div>
  );
}
