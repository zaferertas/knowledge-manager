import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { authError } from '../auth/browser.js';
import { AUTH_DB } from '../auth/service.js';
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
  constructor(@Inject(AUTH_DB) private readonly db: pg.Pool) {}

  async create(userId: string, title: string, body = '') {
    const { rows: [note] } = await this.db.query<Note>(`
      INSERT INTO notes (user_id, title, body) VALUES ($1, $2, $3) RETURNING ${fields}, ARRAY[]::uuid[] AS "tagIds"
    `, [userId, title, body]);
    return note;
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
    const changed = 'title <> COALESCE($3, title) OR body <> COALESCE($4, body)';
    const { rows: [note] } = await this.db.query<Note>(`
      UPDATE notes SET
        title = COALESCE($3, title),
        body = COALESCE($4, body),
        content_revision = CASE WHEN ${changed} THEN content_revision + 1 ELSE content_revision END,
        updated_at = CASE WHEN ${changed} THEN clock_timestamp() ELSE updated_at END,
        indexing_status = CASE WHEN ${changed} THEN 'pending' ELSE indexing_status END
      WHERE user_id = $1 AND id = $2
      RETURNING ${fields}, ${tagIds}
    `, [userId, id, title, body]);
    return requireNote(note);
  }

  async delete(userId: string, id: string) {
    const result = await this.db.query('DELETE FROM notes WHERE user_id = $1 AND id = $2', [userId, id]);
    if (!result.rowCount) throw authError(404, 'NOT_FOUND', 'Resource not found.');
  }
}
