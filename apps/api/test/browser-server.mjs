import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrateDatabase } from '../../../packages/database/migrate.mjs';
import { createApp } from '../dist/app.js';

const database = `knowledge_hub_web_${randomUUID().replaceAll('-', '')}`;
const config = {
  user: process.env.PGUSER ?? 'knowledge_hub',
  password: process.env.PGPASSWORD ?? 'local-development-only',
  port: Number(process.env.PGPORT ?? process.env.POSTGRES_PORT ?? 5432),
};
const admin = new pg.Client({ ...config, database: process.env.PGDATABASE ?? 'knowledge_hub' });
const pool = new pg.Pool({ ...config, database });
const reportPoolError = (error) => console.error(error);
pool.on('error', reportPoolError);
pool.on('connect', (client) => client.on('error', reportPoolError));
let app;
let created = false;

await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  await migrateDatabase(pool);
  Object.assign(process.env, {
    PGDATABASE: database,
    PGUSER: config.user,
    PGPASSWORD: config.password,
    PGPORT: String(config.port),
    NODE_ENV: 'test',
    WEB_ORIGINS: 'http://127.0.0.1:4173',
    OLLAMA_BASE_URL: 'http://127.0.0.1:1',
  });
  delete process.env.DATABASE_URL;
  app = await createApp(false);
  await app.listen(3104, '127.0.0.1');
  await new Promise((resolve) => {
    process.once('SIGTERM', resolve);
    process.once('SIGINT', resolve);
  });
} finally {
  try {
    await app?.close();
    await pool.end();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
  } finally {
    await admin.end();
  }
}
