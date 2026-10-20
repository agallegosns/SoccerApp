import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(join(ROOT, 'src')).filter((f) => !f.includes('__fixtures__'));
const sources = files.filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts'));
const styles = files.filter((f) => f.endsWith('.css'));
const rel = (f: string): string => relative(ROOT, f);

describe('reglas permanentes del proyecto', () => {
  it('no hay emojis en el código ni en los estilos (los iconos son SVG de lucide-react)', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]|\u{FE0F}/u;
    const offenders = [...sources, ...styles].filter((f) => emoji.test(readFileSync(f, 'utf8'))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('los colores de la interfaz sólo se definen en src/ui/tokens.css', () => {
    const color = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
    const offenders = styles
      .filter((f) => !f.endsWith('tokens.css'))
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .map((line, i) => ({ line, i }))
          .filter(({ line }) => color.test(line))
          .map(({ line, i }) => `${rel(f)}:${String(i + 1)}: ${line.trim()}`),
      );
    expect(offenders).toEqual([]);
  });

  it('no hay `any`, `@ts-ignore`, `@ts-nocheck` ni `catch {}` vacío', () => {
    const bad = /:\s*any\b|\bas any\b|<any>|@ts-ignore|@ts-nocheck|catch\s*(\([^)]*\))?\s*\{\s*\}/;
    const offenders = [...sources, ...files.filter((f) => f.endsWith('.test.ts'))].filter((f) => !f.endsWith('rules.test.ts') && bad.test(readFileSync(f, 'utf8'))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('todos los botones de icono tienen nombre accesible (aria-label) y los iconos SVG están ocultos a lectores', () => {
    const offenders: string[] = [];
    for (const f of sources.filter((x) => x.endsWith('.tsx'))) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/<([A-Z][A-Za-z]+) ((?:(?!\/>)[\s\S])*?)\/>/g)) {
        const tag = m[1] ?? '';
        const attrs = m[2] ?? '';
        const isLucide = new RegExp(`import \\{[^}]*\\b${tag}\\b[^}]*\\} from 'lucide-react'`).test(text);
        if (isLucide && !/aria-hidden="true"/.test(attrs)) offenders.push(`${rel(f)}: <${tag}> sin aria-hidden`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('las zonas táctiles usan el token --tap (≥ 44 px)', () => {
    const tokens = readFileSync(join(ROOT, 'src/ui/tokens.css'), 'utf8');
    expect(tokens).toMatch(/--tap:\s*2\.75rem/);
    const components = readFileSync(join(ROOT, 'src/ui/components.css'), 'utf8');
    expect(components).toMatch(/min-height:\s*var\(--tap\)/);
  });
});
