import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
/** Segunda compilación con VP9 como códec de exportación: el Chromium del sandbox no codifica H.264 pero sí VP9. */
const PORT_VP9 = 4174;

// En el sandbox Chromium vive en /opt/pw-browsers (PLAYWRIGHT_BROWSERS_PATH). No se ejecuta `playwright install`.
// `PW_CHROMIUM_PATH` permite apuntar a otro binario (p. ej. el Chromium completo en lugar del headless shell).
const executablePath = process.env['PW_CHROMIUM_PATH'];

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium-desktop',
      testIgnore: /export-ui\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${PORT}`,
        ...(executablePath === undefined ? {} : { launchOptions: { executablePath } }),
      },
    },
    {
      name: 'chromium-export-vp9',
      testMatch: /export-ui\.spec\.ts/,
      timeout: 360_000,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${PORT_VP9}`,
        ...(executablePath === undefined ? {} : { launchOptions: { executablePath } }),
      },
    },
  ],
  webServer: [
    {
      command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: `VITE_EXPORT_CODEC=vp9 npx vite build --outDir dist-vp9 --emptyOutDir && npx vite preview --outDir dist-vp9 --host 127.0.0.1 --port ${PORT_VP9} --strictPort`,
      url: `http://127.0.0.1:${PORT_VP9}`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
