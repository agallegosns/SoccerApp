import { ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

interface Props {
  readonly title: string;
  /** Una línea que dice qué hay dentro (se ve con la tarjeta cerrada). */
  readonly hint?: string;
  /** Estado inicial en pantallas estrechas. En pantallas anchas (≥ 64 rem) siempre empieza abierta. */
  readonly defaultOpen?: boolean;
  readonly className?: string;
  readonly testId?: string;
  readonly children: ReactNode;
}

const isWide = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 64rem)').matches;

/** Tarjeta plegable: en el móvil evita páginas interminables; el contenido sigue montado (no pierde su estado) y sólo se oculta. */
export function Collapsible({ title, hint, defaultOpen = false, className = '', testId, children }: Props) {
  const [open, setOpen] = useState(() => defaultOpen || isWide());
  const titleId = useId();
  const bodyId = useId();
  return (
    <section className={`card collapsible ${className}`.trim()} aria-labelledby={titleId} data-testid={testId}>
      <h2 id={titleId} className="collapsible__title">
        <button type="button" className="collapsible__toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => { setOpen((o) => !o); }}>
          <span className="collapsible__text">
            <span>{title}</span>
            {hint !== undefined && !open && <span className="collapsible__hint">{hint}</span>}
          </span>
          <ChevronDown aria-hidden="true" size={20} className="collapsible__chevron" />
        </button>
      </h2>
      <div id={bodyId} className="collapsible__body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
