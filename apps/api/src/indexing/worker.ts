import { Logger, run } from 'graphile-worker';
import { databasePool } from '../common/database.js';
import { ollamaEmbeddingProvider } from './embedding.js';
import { backfillIndexing, reconcileFailedIndexing } from './queue.js';
import { indexNoteTask } from './task.js';

async function main() {
  const provider = ollamaEmbeddingProvider();
  const db = databasePool();
  try {
    await backfillIndexing(db, provider.modelId);
    const reconcile = () => reconcileFailedIndexing(db, provider.modelId)
      .catch(() => console.error('Indexing status reconciliation failed.'));
    await reconcile();
    const runner = await run({
      pgPool: db,
      taskList: { 'index-note': indexNoteTask(db, provider) },
      logger: new Logger(() => (level) => {
        if (level === 'error' || level === 'warning') console.error('Indexing worker reported an error.');
      }),
    });
    const timer = setInterval(() => void reconcile(), 60_000);
    console.info('Indexing worker started.');
    try {
      await runner.promise;
    } finally {
      clearInterval(timer);
    }
  } finally {
    await db.end();
  }
}

main().catch(() => {
  console.error('Indexing worker could not run. Check database migrations and embedding configuration.');
  process.exitCode = 1;
});
