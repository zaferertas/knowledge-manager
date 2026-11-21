import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { migrateDatabase, seedDatabase } from '../migrate.mjs';

test('migrations rebuild the relational core and initialize the job queue', async () => {
  const database = `knowledge_hub_test_${randomUUID().replaceAll('-', '')}`;
  const config = {
    user: process.env.PGUSER ?? 'knowledge_hub',
    password: process.env.PGPASSWORD ?? 'local-development-only',
    port: Number(process.env.PGPORT ?? process.env.POSTGRES_PORT ?? 5432),
  };
  const admin = new pg.Client({ ...config, database: process.env.PGDATABASE ?? 'knowledge_hub' });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    const connection = new pg.Pool({ ...config, database });
    const poolErrors = [];
    const recordPoolError = (error) => poolErrors.push(error);
    connection.on('error', recordPoolError);
    connection.on('connect', (client) => client.on('error', recordPoolError));
    try {
      await migrateDatabase(connection);
      await migrateDatabase(connection);
      assert.equal((await connection.query('SELECT id FROM graphile_worker.jobs')).rowCount, 0);
      const { rows: [job] } = await connection.query(
        "SELECT id FROM graphile_worker.add_job('migration-smoke', '{}')",
      );
      const { rows: [queuedJob] } = await connection.query(
        'SELECT id, task_identifier FROM graphile_worker.jobs WHERE id = $1',
        [job.id],
      );
      assert.equal(queuedJob?.task_identifier, 'migration-smoke');
      const { rows: [owner, other] } = await connection.query(
        "INSERT INTO users (email, password_hash) VALUES ('owner@example.test', 'fixture'), ('other@example.test', 'fixture') RETURNING id",
      );
      await assert.rejects(connection.query(
        "INSERT INTO users (email, password_hash) VALUES ('owner@example.test', 'fixture')",
      ), { code: '23505' });
      await connection.query(
        "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, 'fixture', now() + interval '1 hour')",
        [owner.id],
      );
      const { rows: [note] } = await connection.query(
        "INSERT INTO notes (user_id, title) VALUES ($1, 'Synthetic note') RETURNING id, content_revision, indexing_status",
        [owner.id],
      );
      assert.equal(note.content_revision, 1);
      assert.equal(note.indexing_status, 'pending');
      const insertEmbedding = `
        INSERT INTO note_embeddings (note_id, content_revision, model_id, embedding)
        VALUES ($1, $2, 'synthetic-model', $3)
      `;
      const vector = JSON.stringify([1, ...Array(767).fill(0)]);
      await assert.rejects(connection.query(insertEmbedding, [note.id, 1, '[1,0,0]']), { code: '22000' });
      await assert.rejects(connection.query(insertEmbedding, [note.id, 0, vector]), { code: '23514' });
      await assert.rejects(connection.query(insertEmbedding, [randomUUID(), 1, vector]), { code: '23503' });
      await connection.query(insertEmbedding, [note.id, note.content_revision, vector]);
      await assert.rejects(connection.query(insertEmbedding, [note.id, 2, vector]), { code: '23505' });
      const { rows: [embedding] } = await connection.query(`
        SELECT content_revision, model_id, vector_dims(embedding) AS dimensions,
          embedding <=> $2::vector AS distance
        FROM note_embeddings WHERE note_id = $1
      `, [note.id, vector]);
      assert.deepEqual(embedding, {
        content_revision: 1, model_id: 'synthetic-model', dimensions: 768, distance: 0,
      });
      const { rows: [tag, otherTag] } = await connection.query(
        "INSERT INTO tags (user_id, name, normalized_name) VALUES ($1, 'Demo', 'demo'), ($2, 'Demo', 'demo') RETURNING id",
        [owner.id, other.id],
      );
      await assert.rejects(connection.query(
        "INSERT INTO tags (user_id, name, normalized_name) VALUES ($1, 'DEMO', 'demo')", [owner.id],
      ), { code: '23505' });

      const attach = 'INSERT INTO note_tags (user_id, note_id, tag_id) VALUES ($1, $2, $3)';
      await assert.rejects(connection.query(attach, [owner.id, note.id, otherTag.id]),
        { code: '23503', constraint: 'note_tags_owned_tag_fk' });
      await assert.rejects(connection.query(attach, [other.id, note.id, otherTag.id]),
        { code: '23503', constraint: 'note_tags_owned_note_fk' });
      await connection.query(attach, [owner.id, note.id, tag.id]);
      await connection.query('DELETE FROM tags WHERE id = $1', [tag.id]);
      assert.equal((await connection.query('SELECT * FROM note_tags')).rowCount, 0);
      assert.equal((await connection.query('SELECT * FROM notes')).rowCount, 1);

      await connection.query('DELETE FROM users WHERE id = $1', [owner.id]);
      assert.equal((await connection.query('SELECT * FROM sessions')).rowCount, 0);
      assert.equal((await connection.query('SELECT * FROM notes')).rowCount, 0);
      assert.equal((await connection.query('SELECT * FROM note_embeddings')).rowCount, 0);
      assert.equal((await connection.query('SELECT * FROM tags')).rowCount, 1);

      await seedDatabase(connection);
      await connection.query("UPDATE notes SET title = 'Edited fixture note'");
      await seedDatabase(connection);
      const { rows: seededNotes } = await connection.query(`
        SELECT users.email, notes.title, notes.indexing_status, tags.normalized_name
        FROM note_tags
        JOIN users ON users.id = note_tags.user_id
        JOIN notes ON notes.id = note_tags.note_id
        JOIN tags ON tags.id = note_tags.tag_id
      `);
      assert.deepEqual(seededNotes, [{
        email: 'field-notes@example.test', title: 'Edited fixture note',
        indexing_status: 'pending', normalized_name: 'gardening',
      }]);
      assert.equal((await connection.query('SELECT id FROM notes')).rowCount, 1);
    } finally {
      await connection.end();
      await admin.query(`DROP DATABASE "${database}"`);
      assert.deepEqual(poolErrors, []);
    }
  } finally {
    await admin.end();
  }
});
