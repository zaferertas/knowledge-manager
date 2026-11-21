import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { runMigrations } from 'graphile-worker';
import pg from 'pg';

export async function migrateDatabase(connection) {
  const migrationsFolder = fileURLToPath(new URL('./migrations/', import.meta.url));
  await migrate(drizzle(connection), { migrationsFolder });
  await runMigrations({ pgPool: connection });
}

export async function seedDatabase(connection) {
  const seed = await readFile(new URL('./seed.sql', import.meta.url), 'utf8');
  await connection.query(seed);
}

if (import.meta.main) {
  const connection = new pg.Pool({
    database: process.env.PGDATABASE ?? 'knowledge_hub',
    user: process.env.PGUSER ?? 'knowledge_hub',
    port: Number(process.env.PGPORT ?? process.env.POSTGRES_PORT ?? 5432),
  });
  const reportPoolError = (error) => {
    console.error('PostgreSQL migration pool error:', error);
    process.exitCode = 1;
  };
  connection.on('error', reportPoolError);
  connection.on('connect', (client) => client.on('error', reportPoolError));
  try {
    if (process.argv[2] === 'seed') {
      await seedDatabase(connection);
    } else {
      await migrateDatabase(connection);
    }
  } finally {
    await connection.end();
  }
}
