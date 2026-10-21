import { Dialog } from './Dialog.tsx';

interface Props {
  readonly open: boolean;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** Confirmación propia (no usa `window.confirm`, que bloquea la página y no se puede probar ni estilar). */
export function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onCancel }: Props) {
  return (
    <Dialog open={open} title={title} onClose={onCancel} testId="confirm-dialog">
      <p>{message}</p>
      <div className="dialog__actions">
        <button type="button" className="btn" onClick={onCancel} data-testid="confirm-cancel">
          Cancelar
        </button>
        <button type="button" className="btn btn--primary" onClick={onConfirm} data-testid="confirm-ok">
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
