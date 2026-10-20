/**
 * Trabajos que no se pueden interrumpir (exportar un vídeo, generar un lote): mientras haya alguno, la app NO se recarga sola
 * para actualizarse, así que no se pierde nada. Cada trabajo se identifica con una clave.
 */
const active = new Set<string>();
const listeners = new Set<() => void>();

export function setBusy(key: string, busy: boolean): void {
  const changed = busy ? !active.has(key) : active.delete(key);
  if (busy) active.add(key);
  if (changed) for (const l of listeners) l();
}

export function isBusy(): boolean {
  return active.size > 0;
}

export function subscribeBusy(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
