/** Compila `cloudflare/stats-worker.ts` a JavaScript (`cloudflare/stats-worker.js`) para pegarlo en el editor de Cloudflare sin instalar nada. */
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

const source = new URL('../cloudflare/stats-worker.ts', import.meta.url);
const target = new URL('../cloudflare/stats-worker.js', import.meta.url);

const out = ts.transpileModule(readFileSync(source, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: false },
  reportDiagnostics: true,
});
if (out.diagnostics !== undefined && out.diagnostics.length > 0) {
  for (const d of out.diagnostics) console.error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  process.exit(1);
}
if (!/export default\s*\{/.test(out.outputText)) {
  console.error('El Worker compilado no exporta `export default { fetch, scheduled }`.');
  process.exit(1);
}
writeFileSync(target, `// ARCHIVO GENERADO desde cloudflare/stats-worker.ts con «npm run build:worker». No lo edites a mano.\n${out.outputText}`);
console.log('Escrito cloudflare/stats-worker.js');
