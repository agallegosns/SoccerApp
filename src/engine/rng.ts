/** PRNG determinista mulberry32: misma semilla ⇒ misma secuencia. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash FNV-1a de 32 bits para mezclar texto en una semilla. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  /** Real en [0, 1). */
  float(): number;
  /** Real en [min, max). */
  float(min: number, max: number): number;
  float(min = 0, max = 1): number {
    return min + this.next() * (max - min);
  }

  /** Entero en [min, max], ambos incluidos. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error('Rng.pick: lista vacía');
    return item;
  }

  /** Elige con probabilidad proporcional al peso. */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((sum, [, w]) => sum + w, 0);
    let r = this.next() * total;
    for (const [item, weight] of items) {
      r -= weight;
      if (r < 0) return item;
    }
    const last = items.at(-1);
    if (last === undefined) throw new Error('Rng.weighted: lista vacía');
    return last[0];
  }

  /** Copia barajada (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      const a = out[i];
      const b = out[j];
      if (a === undefined || b === undefined) throw new Error('Rng.shuffle: índice fuera de rango');
      out[i] = b;
      out[j] = a;
    }
    return out;
  }
}
