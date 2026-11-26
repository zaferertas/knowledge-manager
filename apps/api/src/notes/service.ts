import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { authError } from '../auth/browser.js';
import { AUTH_DB } from '../auth/service.js';
import { transaction } from '../common/database.js';
import { embeddingModel } from '../indexing/config.js';
import { enqueueIndexing } from '../indexing/queue.js';
import type { Note } from './dto.js';

const fields = `id, title, body, content_revision AS "contentRevision",
  indexing_status AS "indexingStatus", created_at AS "createdAt", updated_at AS "updatedAt"`;

const tagIds = `ARRAY(
  SELECT tag_id FROM note_tags
  WHERE user_id = notes.user_id AND note_id = notes.id ORDER BY tag_id
) AS "tagIds"`;

function requireNote(note: Note | undefined): Note {
  if (!note) throw authError(404, 'NOT_FOUND', 'Resource not found.');
  return note;
}

@Injectable()
export class NotesService {
  private readonly modelId = embeddingModel();

  constructor(@Inject(AUTH_DB) private readonly db: pg.Pool) {}

  async create(userId: string, title: string, body = '') {
    return transaction(this.db, async (client) => {
      const { rows: [note] } = await client.query<Note>(`
        INSERT INTO notes (user_id, title, body) VALUES ($1, $2, $3)
        RETURNING ${fields}, ARRAY[]::uuid[] AS "tagIds"
      `, [userId, title, body]);
      await enqueueIndexing(client, userId, note.id, this.modelId);
      return note;
    });
  }

  async list(userId: string, limit: number, offset: number, tagId?: string) {
    const { rows } = await this.db.query<Note>(`
      SELECT ${fields}, ${tagIds} FROM notes WHERE user_id = $1
      AND ($4::uuid IS NULL OR EXISTS (
        SELECT 1 FROM note_tags
        WHERE user_id = notes.user_id AND note_id = notes.id AND tag_id = $4
      ))
      ORDER BY updated_at DESC, id ASC LIMIT $2 OFFSET $3
    `, [userId, limit + 1, offset, tagId]);
    return { items: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
  }

  async read(userId: string, id: string) {
    const { rows: [note] } = await this.db.query<Note>(`
      SELECT ${fields}, ${tagIds} FROM notes WHERE user_id = $1 AND id = $2
    `, [userId, id]);
    return requireNote(note);
  }

  async update(userId: string, id: string, title?: string, body?: string) {
    return transaction(this.db, async (client) => {
      const { rows } = await client.query<Note>(
        `SELECT ${fields}, ${tagIds} FROM notes WHERE user_id = $1 AND id = $2 FOR UPDATE`, [userId, id],
      );
      const previous = requireNote(rows[0]);
      const nextTitle = title ?? previous.title;
      const nextBody = body ?? previous.body;
      if (nextTitle === previous.title && nextBody === previous.body) return previous;
      const { rows: [note] } = await client.query<Note>(`
        UPDATE notes SET title = $3, body = $4, content_revision = content_revision + 1,
          updated_at = clock_timestamp(), indexing_status = 'pending'
        WHERE user_id = $1 AND id = $2 RETURNING ${fields}, ${tagIds}
      `, [userId, id, nextTitle, nextBody]);
      await enqueueIndexing(client, userId, id, this.modelId);
      return note;
    });
  }

  async reindex(userId: string, id: string) {
    await transaction(this.db, async (client) => {
      const { rows: [note] } = await client.query<{ indexing_status: Note['indexingStatus']; indexing_model: string | null }>(
        'SELECT indexing_status, indexing_model FROM notes WHERE user_id = $1 AND id = $2 FOR UPDATE', [userId, id],
      );
      if (!note) throw authError(404, 'NOT_FOUND', 'Resource not found.');
      if (note.indexing_status !== 'pending' || note.indexing_model !== this.modelId) {
        await enqueueIndexing(client, userId, id, this.modelId);
      }
    });
  }

  async delete(userId: string, id: string) {
    const result = await this.db.query('DELETE FROM notes WHERE user_id = $1 AND id = $2', [userId, id]);
    if (!result.rowCount) throw authError(404, 'NOT_FOUND', 'Resource not found.');
  }
}
