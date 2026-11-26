import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Logger, run } from 'graphile-worker';
import pg from 'pg';
import { migrateDatabase } from '../../../packages/database/migrate.mjs';
import { createApp } from '../dist/app.js';
import { ollamaEmbeddingProvider } from '../dist/indexing/embedding.js';
import { indexNoteTask } from '../dist/indexing/task.js';

const excerpt = 'The field station uses a yellow radio.';
const vector = (axis) => Array.from({ length: 768 }, (_, index) => Number(index === axis));
const model = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const { input, messages } = JSON.parse(Buffer.concat(chunks).toString());
  const send = (body) => response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  if (request.url === '/api/embed') {
    if (input === 'search_query: What is the wind speed?') return send({ embeddings: [vector(1)] });
    if (input === 'search_query: What color is the radio?' ||
        input === `search_document: Field station\n\n${excerpt}`) return send({ embeddings: [vector(0)] });
  }
  if (request.url === '/api/chat') {
    const { sources: [source] } = JSON.parse(messages[1].content);
    return send({ done: true, done_reason: 'stop', message: {
      content: JSON.stringify({ evidence: [{ noteId: source.noteId, excerpt }] }),
    } });
  }
  response.writeHead(503).end();
});

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
let worker;
let created = false;

await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  await migrateDatabase(pool);
  await new Promise((resolve, reject) => model.listen(0, '127.0.0.1', resolve).once('error', reject));
  Object.assign(process.env, {
    PGDATABASE: database,
    PGUSER: config.user,
    PGPASSWORD: config.password,
    PGPORT: String(config.port),
    NODE_ENV: 'test',
    WEB_ORIGINS: 'http://127.0.0.1:4173',
    OLLAMA_URL: `http://127.0.0.1:${model.address().port}`,
  });
  delete process.env.DATABASE_URL;
  app = await createApp(false);
  worker = await run({
    pgPool: pool,
    taskList: { 'index-note': indexNoteTask(pool, ollamaEmbeddingProvider()) },
    pollInterval: 100,
    noHandleSignals: true,
    logger: new Logger(() => () => {}),
  });
  await app.listen(3104, '127.0.0.1');
  await new Promise((resolve) => {
    process.once('SIGTERM', resolve);
    process.once('SIGINT', resolve);
  });
} finally {
  try {
    await app?.close();
    await worker?.stop();
    model.close();
    await pool.end();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
  } finally {
    await admin.end();
  }
}
