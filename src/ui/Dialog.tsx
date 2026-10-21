import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly testId?: string;
}

/** Ventana modal accesible (elemento nativo `<dialog>`): foco atrapado, Escape para cerrar y contenido que se reinicia al cerrarla. */
export function Dialog({ open, title, onClose, children, testId }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onClose={onClose} data-testid={testId}>
      {open && (
        <div className="dialog__body">
          <div className="dialog__head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}>
              <X aria-hidden="true" size={22} />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
