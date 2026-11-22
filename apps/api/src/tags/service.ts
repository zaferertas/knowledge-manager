import { Inject, Injectable } from '@nestjs/common';
import pg from 'pg';
import { authError } from '../auth/browser.js';
import { AUTH_DB } from '../auth/service.js';
import type { Tag } from './dto.js';

const fields = 'id, name, created_at AS "createdAt"';

function notFound() {
  return authError(404, 'NOT_FOUND', 'Resource not found.');
}

function nameInUse() {
  return authError(409, 'TAG_NAME_IN_USE', 'A tag with this name already exists.');
}

@Injectable()
export class TagsService {
  constructor(@Inject(AUTH_DB) private readonly db: pg.Pool) {}

  async list(userId: string) {
    const { rows } = await this.db.query<Tag>(`
      SELECT ${fields} FROM tags WHERE user_id = $1 ORDER BY normalized_name, id
    `, [userId]);
    return rows;
  }

  async create(userId: string, name: string, normalizedName: string) {
    const { rows: [tag] } = await this.db.query<Tag>(`
      INSERT INTO tags (user_id, name, normalized_name) VALUES ($1, $2, $3)
      ON CONFLICT (user_id, normalized_name) DO NOTHING
      RETURNING ${fields}
    `, [userId, name, normalizedName]);
    if (!tag) throw nameInUse();
    return tag;
  }

  async rename(userId: string, id: string, name: string, normalizedName: string) {
    try {
      const { rows: [tag] } = await this.db.query<Tag>(`
        UPDATE tags SET name = $3, normalized_name = $4 WHERE user_id = $1 AND id = $2
        RETURNING ${fields}
      `, [userId, id, name, normalizedName]);
      if (!tag) throw notFound();
      return tag;
    } catch (error) {
      if (error instanceof pg.DatabaseError && error.code === '23505' && error.constraint === 'tags_owner_name_unique') {
        throw nameInUse();
      }
      throw error;
    }
  }

  async delete(userId: string, id: string) {
    const result = await this.db.query('DELETE FROM tags WHERE user_id = $1 AND id = $2', [userId, id]);
    if (!result.rowCount) throw notFound();
  }

  async replaceForNote(userId: string, noteId: string, tagIds: string[]) {
    const client = await this.db.connect();
    let discardClient = false;
    try {
      await client.query('BEGIN');
      // The note lock serializes replacements and keeps the note alive until commit.
      const note = await client.query('SELECT 1 FROM notes WHERE user_id = $1 AND id = $2 FOR UPDATE', [userId, noteId]);
      if (!note.rowCount) throw notFound();

      // Hold the requested tags against deletion until their associations are committed.
      const tags = await client.query(`
        SELECT id FROM tags WHERE user_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR KEY SHARE
      `, [userId, tagIds]);
      if (tags.rowCount !== tagIds.length) throw notFound();

      await client.query('DELETE FROM note_tags WHERE user_id = $1 AND note_id = $2', [userId, noteId]);
      await client.query(`
        INSERT INTO note_tags (user_id, note_id, tag_id)
        SELECT $1, $2, id FROM unnest($3::uuid[]) AS tag(id)
      `, [userId, noteId, tagIds]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => { discardClient = true; });
      throw error;
    } finally {
      client.release(discardClient);
    }
  }
}
