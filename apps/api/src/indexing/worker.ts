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
    const indexNote = indexNoteTask(db, provider);
    const runner = await run({
      pgPool: db,
      taskList: { 'index-note': async (payload, helpers) => {
        const started = performance.now();
        let outcome = 'failed';
        try {
          await indexNote(payload, helpers);
          outcome = 'completed';
        } finally {
          console.info(JSON.stringify({
            event: 'index_note_attempt', outcome, attempt: helpers.job.attempts,
            durationMs: Math.round(performance.now() - started),
          }));
        }
      } },
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
