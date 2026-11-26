import type { Task } from 'graphile-worker';
import type pg from 'pg';
import { transaction } from '../common/database.js';
import { isUuid } from '../common/input.js';
import { embeddingDimensions } from './config.js';
import { type EmbeddingProvider, validEmbedding } from './embedding.js';

type IndexNote = { userId: string; noteId: string; contentRevision: number; modelId: string; requestId: string };

function isIndexNote(payload: unknown): payload is IndexNote {
  if (!payload || typeof payload !== 'object') return false;
  const { userId, noteId, contentRevision, modelId, requestId } = payload as IndexNote;
  return isUuid(userId) && isUuid(noteId) && isUuid(requestId) && Number.isInteger(contentRevision) &&
    contentRevision > 0 && typeof modelId === 'string';
}

const current = `user_id = $1 AND id = $2 AND content_revision = $3 AND indexing_model = $4
  AND indexing_request = $5 AND indexing_status = 'pending'`;

export function indexNoteTask(db: pg.Pool, provider: EmbeddingProvider): Task {
  if (provider.dimensions !== embeddingDimensions) throw new Error('Embedding provider must use 768 dimensions.');
  return async (payload, { job }) => {
    if (!isIndexNote(payload)) throw new Error('Invalid index-note payload.');
    const { userId, noteId, contentRevision, modelId, requestId } = payload;
    const parameters = [userId, noteId, contentRevision, modelId, requestId];
    const { rows: [note] } = await db.query<{ title: string; body: string }>(
      `SELECT title, body FROM notes WHERE ${current}`, parameters,
    ).catch(() => { throw new Error('Could not read note for indexing.'); });
    if (!note) return;
    if (modelId !== provider.modelId) throw new Error('Index-note model does not match this worker.');
    try {
      const vector = await provider.embedDocument(`${note.title}\n\n${note.body}`);
      if (!validEmbedding(vector, provider.dimensions)) throw new Error('Invalid embedding.');

      await transaction(db, async (client) => {
        const updated = await client.query(`UPDATE notes SET indexing_status = 'ready' WHERE ${current}`, parameters);
        if (!updated.rowCount) return;
        await client.query(`
          INSERT INTO note_embeddings (note_id, content_revision, model_id, embedding)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (note_id) DO UPDATE SET content_revision = excluded.content_revision,
            model_id = excluded.model_id, embedding = excluded.embedding, created_at = clock_timestamp()
        `, [noteId, contentRevision, modelId, JSON.stringify(vector)]);
      });
    } catch {
      if (job.attempts >= job.max_attempts) {
        await db.query(`UPDATE notes SET indexing_status = 'failed' WHERE ${current}`, parameters).catch(() => {
          // The worker reconciles exhausted jobs if this write fails.
        });
      }
      throw new Error('Note indexing failed.');
    }
  };
}
