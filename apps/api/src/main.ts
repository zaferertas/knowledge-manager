import { createApp } from './app.js';

async function main() {
  const port = Number(process.env.API_PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT must be an integer between 1 and 65535');
  }
  const app = await createApp();
  await app.listen(port, '127.0.0.1');
}

void main().catch(() => {
  console.error(JSON.stringify({ event: 'api_start_failed' }));
  process.exitCode = 1;
});
