import type pg from 'pg';
import { transaction } from '../common/database.js';

export async function enqueueIndexing(client: pg.PoolClient, userId: string, noteId: string, modelId: string) {
  await client.query(`
    WITH scheduled AS (
      UPDATE notes SET indexing_status = 'pending', indexing_model = $3, indexing_request = gen_random_uuid()
      WHERE user_id = $1 AND id = $2
      RETURNING content_revision, indexing_request
    )
    SELECT graphile_worker.add_job(
      'index-note',
      payload := json_build_object('userId', $1::uuid, 'noteId', $2::uuid, 'modelId', $3::text,
        'contentRevision', content_revision, 'requestId', indexing_request),
      max_attempts := 5,
      job_key := 'index-note:' || indexing_request
    ) FROM scheduled
  `, [userId, noteId, modelId]);
}

export async function backfillIndexing(db: pg.Pool, modelId: string) {
  let count: number;
  do {
    count = await transaction(db, async (client) => {
      const { rows } = await client.query<{ id: string; user_id: string }>(`
        SELECT id, user_id FROM notes WHERE indexing_model IS DISTINCT FROM $1
        ORDER BY id LIMIT 100 FOR UPDATE
      `, [modelId]);
      for (const note of rows) await enqueueIndexing(client, note.user_id, note.id, modelId);
      return rows.length;
    });
  } while (count === 100);
}

export async function reconcileFailedIndexing(db: pg.Pool, modelId: string) {
  await db.query(`
    UPDATE notes SET indexing_status = 'failed'
    FROM graphile_worker.jobs AS jobs
    WHERE notes.indexing_status = 'pending' AND notes.indexing_model = $1
      AND jobs.key = 'index-note:' || notes.indexing_request
      AND jobs.attempts >= jobs.max_attempts AND jobs.locked_at IS NULL
  `, [modelId]);
}
