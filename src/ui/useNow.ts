import { useEffect, useState } from 'react';

/** Hora actual en milisegundos, refrescada cada `everyMs` (para estados que dependen de la hora sin llamar a `Date.now()` al pintar). */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => { setNow(Date.now()); }, everyMs);
    return () => { window.clearInterval(id); };
  }, [everyMs]);
  return now;
}
