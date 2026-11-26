import pg from 'pg';

export function databasePool() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    database: process.env.PGDATABASE ?? 'knowledge_hub',
    user: process.env.PGUSER ?? 'knowledge_hub',
    port: Number(process.env.PGPORT ?? process.env.POSTGRES_PORT ?? 5432),
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', () => console.error('Idle PostgreSQL connection failed.'));
  return pool;
}

export async function transaction<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => { discard = true; });
    throw error;
  } finally {
    client.release(discard);
  }
}
