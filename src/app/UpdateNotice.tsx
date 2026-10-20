import { RefreshCw } from 'lucide-react';
import { useSyncExternalStore } from 'react';

import { updatePending } from './autoUpdate.ts';

/** Sólo aparece si hay una versión nueva y hay que esperar (p. ej. a que termine una exportación). */
export function UpdateNotice() {
  const pending = useSyncExternalStore(updatePending.subscribe, updatePending.get, () => false);
  if (!pending) return null;
  return (
    <p className="update-notice" role="status">
      <RefreshCw aria-hidden="true" size={16} />
      Hay una versión nueva: la app se actualizará sola al terminar lo que estás haciendo.
    </p>
  );
}
