import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Identificador único de cada compilación: el commit en CI o la hora en local. La app lo compara con `version.json` para actualizarse sola.
const BUILD_ID = (process.env['GITHUB_SHA'] ?? '').slice(0, 12) || Date.now().toString(36);

function emitVersion(): Plugin {
  return {
    name: 'emit-version',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) });
    },
  };
}

// `VITE_BASE` permite servir la app bajo una subruta (p. ej. GitHub Pages: /SoccerApp/).
export default defineConfig({
  base: process.env['VITE_BASE'] ?? '/',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react(), emitVersion()],
  build: { target: 'es2023', sourcemap: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'cloudflare/**/*.test.ts'],
  },
});
