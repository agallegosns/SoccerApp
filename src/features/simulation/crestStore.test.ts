import { describe, expect, it } from 'vitest';

import type { KeyValueStore } from '../../data/cache.ts';
import { DataError } from '../../data/types.ts';
import { MAX_CREST_FILE_BYTES, deleteCrest, readStoredCrest, storeCrest, validateCrestFile } from './crestStore.ts';

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('escudos subidos por el usuario', () => {
  it('acepta PNG, JPG y WebP razonables y rechaza el resto con un mensaje claro', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) expect(validateCrestFile({ type, size: 50_000 })).toBeNull();
    expect(validateCrestFile({ type: 'image/gif', size: 1000 })).toMatch(/PNG, JPG o WebP/);
    expect(validateCrestFile({ type: 'application/pdf', size: 1000 })).toMatch(/PNG, JPG o WebP/);
    expect(validateCrestFile({ type: 'image/png', size: MAX_CREST_FILE_BYTES + 1 })).toMatch(/pesa demasiado/);
    expect(validateCrestFile({ type: 'image/png', size: 0 })).toMatch(/vacío/);
  });

  it('guarda, lee y borra el escudo de cada equipo por separado (clave sin acentos ni mayúsculas)', () => {
    const store = memoryStore();
    expect(readStoredCrest('Atlético de Madrid', store)).toBeNull();
    storeCrest('Atlético de Madrid', 'data:image/png;base64,AAAA', store);
    storeCrest('FC Barcelona', 'data:image/png;base64,BBBB', store);
    expect(readStoredCrest('Atlético de Madrid', store)).toBe('data:image/png;base64,AAAA');
    expect(readStoredCrest('ATLETICO DE MADRID', store)).toBe('data:image/png;base64,AAAA');
    expect(readStoredCrest('FC Barcelona', store)).toBe('data:image/png;base64,BBBB');
    deleteCrest('Atlético de Madrid', store);
    expect(readStoredCrest('Atlético de Madrid', store)).toBeNull();
    expect(readStoredCrest('FC Barcelona', store)).toBe('data:image/png;base64,BBBB');
  });

  it('avisa si el almacenamiento está lleno o no existe', () => {
    const full: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    expect(() => {
      storeCrest('X', 'data:image/png;base64,AAAA', full);
    }).toThrow(DataError);
    expect(() => {
      storeCrest('X', 'data:image/png;base64,AAAA', null);
    }).toThrow(/almacenamiento/);
  });
});
