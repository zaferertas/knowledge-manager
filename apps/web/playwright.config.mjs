import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './test',
  use: {
    baseURL,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  workers: 1,
  webServer: [
    {
      command: 'node --env-file-if-exists=../../.env ../api/test/browser-server.mjs',
      url: 'http://127.0.0.1:3104/api/v1/health',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    },
    {
      command: 'pnpm exec vite --host 127.0.0.1 --port 4173 --strictPort',
      url: baseURL,
      env: { API_PORT: '3104' },
    },
  ],
});
