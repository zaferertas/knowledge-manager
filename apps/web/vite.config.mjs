import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, fileURLToPath(new URL('../../', import.meta.url)), 'API_');
  const apiPort = Number(process.env.API_PORT ?? rootEnv.API_PORT ?? '3000');
  const proxy = { '/api': `http://127.0.0.1:${apiPort}` };
  return { server: { proxy }, preview: { proxy } };
});
