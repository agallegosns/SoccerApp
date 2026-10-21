import { useState } from 'react';

import { Dialog } from '../../ui/Dialog.tsx';
import { LOCAL_DATETIME } from './scheduled.ts';

interface Props {
  readonly open: boolean;
  readonly title: string;
  /** Hora propuesta (`YYYY-MM-DDTHH:mm`). */
  readonly initial: string;
  /** Texto de ayuda (p. ej. la franja orientativa). */
  readonly hint?: string;
  readonly onSave: (localDateTime: string) => void;
  readonly onClose: () => void;
}

/** Pide la hora a la que has programado el vídeo en TikTok/Instagram. La app no programa nada en las plataformas. */
export function ScheduleDialog({ open, title, initial, hint, onSave, onClose }: Props) {
  return (
    <Dialog open={open} title={title} onClose={onClose} testId="schedule-dialog">
      <ScheduleForm initial={initial} hint={hint} onSave={onSave} onClose={onClose} />
    </Dialog>
  );
}

function ScheduleForm({ initial, hint, onSave, onClose }: Pick<Props, 'initial' | 'hint' | 'onSave' | 'onClose'>) {
  const [value, setValue] = useState(initial);
  const valid = LOCAL_DATETIME.test(value);
  return (
    <>
      <p className="muted">
        Apunta aquí la fecha y hora a la que lo has programado en TikTok o Instagram. La app no lo programa por ti: sólo lo recuerda y, cuando llegue la hora, te pregunta si ya se ha publicado.
      </p>
      <label className="field">
        <span>Fecha y hora de publicación</span>
        <input type="datetime-local" value={value} onChange={(e) => { setValue(e.target.value); }} data-testid="schedule-input" />
      </label>
      {hint !== undefined && <p className="muted">{hint}</p>}
      <div className="dialog__actions">
        <button type="button" className="btn" onClick={onClose} data-testid="schedule-cancel">
          Cancelar
        </button>
        <button type="button" className="btn btn--primary" disabled={!valid} onClick={() => { onSave(value); }} data-testid="schedule-save">
          Guardar
        </button>
      </div>
    </>
  );
}
