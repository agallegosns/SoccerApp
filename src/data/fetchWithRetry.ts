import { DataError } from './types.ts';

export interface FetchOptions {
  readonly signal?: AbortSignal | undefined;
  /** Reintentos tras el primer intento (por defecto 2). */
  readonly retries?: number;
  /** Espera base en ms; se duplica en cada reintento (por defecto 600). */
  readonly baseDelayMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new DataError('aborted', 'Operación cancelada'));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DataError('aborted', 'Operación cancelada'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const isAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;

const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;

async function fetchWithRetry<T>(url: string, options: FetchOptions, read: (response: Response) => Promise<T>): Promise<T> {
  const { signal, retries = 2, baseDelayMs = 600, fetchImpl = fetch, sleep = abortableSleep } = options;
  let lastError: DataError | undefined;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (isAborted(signal)) throw new DataError('aborted', 'Operación cancelada');
    try {
      const response = await fetchImpl(url, signal === undefined ? undefined : { signal });
      if (response.ok) return await read(response);
      lastError = new DataError(
        response.status === 404 ? 'not-found' : 'http',
        `El servidor respondió ${String(response.status)} al pedir ${url}`,
        { status: response.status },
      );
      if (!isRetryableStatus(response.status)) throw lastError;
    } catch (error) {
      if (error instanceof DataError) {
        if (error.kind === 'aborted' || error.kind === 'not-found' || !isRetryableStatus(error.status ?? 0)) {
          throw error;
        }
        lastError = error;
      } else if (isAborted(signal)) {
        throw new DataError('aborted', 'Operación cancelada', { cause: error });
      } else {
        lastError = new DataError('network', `No se pudo conectar para pedir ${url}`, { cause: error });
      }
    }
    if (attempt < retries) await sleep(baseDelayMs * 2 ** attempt, signal);
  }
  throw lastError ?? new DataError('network', `No se pudo pedir ${url}`);
}

/** GET con reintentos y espera creciente. 4xx (salvo 429) no se reintentan. Devuelve el cuerpo como texto. */
export function fetchTextWithRetry(url: string, options: FetchOptions = {}): Promise<string> {
  return fetchWithRetry(url, options, (response) => response.text());
}

/** Igual que `fetchTextWithRetry` pero devuelve los bytes (p. ej. un .xlsx). */
export function fetchBytesWithRetry(url: string, options: FetchOptions = {}): Promise<Uint8Array> {
  return fetchWithRetry(url, options, async (response) => new Uint8Array(await response.arrayBuffer()));
}
