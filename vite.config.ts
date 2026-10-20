import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// `VITE_BASE` permite servir la app bajo una subruta (p. ej. GitHub Pages: /SoccerApp/).
export default defineConfig({
  base: process.env['VITE_BASE'] ?? '/',
  plugins: [react()],
  build: { target: 'es2023', sourcemap: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
