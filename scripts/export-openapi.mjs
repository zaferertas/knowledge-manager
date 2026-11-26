import { writeFile } from 'node:fs/promises';
import { createApp, openApiDocument } from '../apps/api/dist/app.js';

process.env.NODE_ENV = 'production';
process.env.WEB_ORIGINS = 'https://notes.example.test';
const app = await createApp(false);
try {
  const target = new URL('../docs/api/v1.openapi.json', import.meta.url);
  await writeFile(target, JSON.stringify(openApiDocument(app), null, 2) + '\n');
} finally {
  await app.close();
}
