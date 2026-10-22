import { Cloud, CloudOff, RefreshCw, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { Dialog } from '../../ui/Dialog.tsx';
import { ConfirmDialog } from '../../ui/ConfirmDialog.tsx';
import { ago } from '../stats/useSync.ts';
import { clearConnection, connectionProblem, readConnection, runDeviceSync, saveConnection, statsConnection, useDeviceSync } from './deviceSync.ts';

/** Botón de la cabecera: muestra el estado de la sincronización entre dispositivos y abre su ventana. */
export function SyncButton() {
  const sync = useDeviceSync();
  const [open, setOpen] = useState(false);
  const label = sync.status === 'off' ? 'Sincronizar dispositivos' : sync.status === 'error' ? 'Sincronización con error' : sync.status === 'syncing' ? 'Sincronizando…' : 'Dispositivos sincronizados';
  return (
    <>
      <button type="button" className="icon-btn sync-btn" onClick={() => { setOpen(true); }} aria-label={label} title={label} data-testid="sync-open" data-status={sync.status}>
        {sync.status === 'off' ? <CloudOff aria-hidden="true" size={22} /> : sync.status === 'syncing' ? <RefreshCw aria-hidden="true" size={22} className="spin" /> : sync.status === 'error' ? <TriangleAlert aria-hidden="true" size={22} /> : <Cloud aria-hidden="true" size={22} />}
      </button>
      <SyncDialog open={open} onClose={() => { setOpen(false); }} />
    </>
  );
}

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
}

function SyncDialog({ open, onClose }: Props) {
  return (
    <Dialog open={open} title="Sincronizar móvil y ordenador" onClose={onClose} testId="device-sync-dialog">
      <SyncBody />
    </Dialog>
  );
}

function SyncBody() {
  const sync = useDeviceSync();
  const connection = readConnection();
  const fromStats = statsConnection();
  const [url, setUrl] = useState(connection?.url ?? '');
  const [key, setKey] = useState(connection?.key ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  if (sync.status === 'off' || connection === null) {
    return (
      <div className="stack">
        <p>
          Lo que hagas en un dispositivo (vídeos, publicado, programado, descargas, estadísticas, calendarios importados y escudos) aparece en los demás. Los vídeos MP4 no viajan: cada dispositivo los vuelve a generar idénticos desde su ficha.
        </p>
        <p className="muted">
          Usa tu Worker de Cloudflare gratuito (el mismo de las estadísticas). Pega aquí la misma dirección y la misma clave en cada dispositivo. Sólo se sincroniza con la app abierta.
        </p>
        {fromStats !== null && (
          <button type="button" className="btn" onClick={() => { setUrl(fromStats.url); setKey(fromStats.key); setProblem(null); }} data-testid="sync-use-stats">
            Usar la conexión de Estadísticas
          </button>
        )}
        <label className="field">
          <span>Dirección del Worker</span>
          <input type="url" inputMode="url" autoComplete="off" placeholder="https://futbol-stats.tu-usuario.workers.dev" value={url} onChange={(e) => { setUrl(e.target.value); }} data-testid="sync-url" />
        </label>
        <label className="field">
          <span>Clave (STATS_KEY)</span>
          <input type="password" autoComplete="off" value={key} onChange={(e) => { setKey(e.target.value); }} data-testid="sync-key" />
        </label>
        {problem !== null && (
          <p className="alert alert--error" role="alert" data-testid="sync-problem">
            {problem}
          </p>
        )}
        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              const p = connectionProblem(url, key);
              setProblem(p);
              if (p === null) saveConnection(url, key);
            }}
            data-testid="sync-connect"
          >
            Conectar y sincronizar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack" data-testid="sync-connected">
      <p data-testid="sync-summary">
        {sync.status === 'syncing' ? 'Sincronizando…' : sync.lastOkAt === null ? 'Esperando la primera sincronización…' : <>Última sincronización: <strong>{ago(new Date(sync.lastOkAt).toISOString())}</strong>.</>}
        {sync.last !== null && sync.status !== 'syncing' && (
          <span className="muted"> {String(sync.last.sent)} {sync.last.sent === 1 ? 'cambio enviado' : 'cambios enviados'} · {String(sync.last.received)} {sync.last.received === 1 ? 'recibido' : 'recibidos'}.</span>
        )}
      </p>
      {sync.status === 'error' && sync.message !== null && (
        <p className="alert alert--error" role="alert" data-testid="sync-error-msg">
          {sync.message}
        </p>
      )}
      {sync.needsReload && (
        <div className="notice notice--warn" data-testid="sync-reload">
          <span>Han llegado calendarios importados: recarga la app para verlos.</span>
          <button type="button" className="btn" onClick={() => { window.location.reload(); }}>
            Recargar
          </button>
        </div>
      )}
      <p className="muted">Servidor: {connection.url}</p>
      <div className="dialog__actions">
        <button type="button" className="btn" onClick={() => { setLeaving(true); }} data-testid="sync-disconnect">
          Dejar de sincronizar
        </button>
        <button type="button" className="btn btn--primary" onClick={() => { void runDeviceSync(); }} disabled={sync.status === 'syncing'} data-testid="sync-now">
          <RefreshCw aria-hidden="true" size={20} />
          Sincronizar ahora
        </button>
      </div>
      <ConfirmDialog
        open={leaving}
        title="Dejar de sincronizar"
        message="Este dispositivo se desconecta del Worker. Tus datos se quedan aquí y en el servidor; no se borra nada."
        confirmLabel="Dejar de sincronizar"
        onCancel={() => { setLeaving(false); }}
        onConfirm={() => { setLeaving(false); clearConnection(); }}
      />
    </div>
  );
}
