import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { runOnce } from 'graphile-worker';
import { migrateDatabase } from '../../../packages/database/migrate.mjs';
import { createApp } from '../dist/app.js';
import { embeddingModel } from '../dist/indexing/config.js';
import { backfillIndexing, reconcileFailedIndexing } from '../dist/indexing/queue.js';
import { indexNoteTask } from '../dist/indexing/task.js';
import { checkAsk } from './ask-cases.mjs';
import { evaluateLiveAsk } from './ask-live.mjs';

test('notes CRUD is validated, paginated and scoped to the signed-in owner', async (t) => {
  const database = `knowledge_hub_notes_${randomUUID().replaceAll('-', '')}`;
  const config = {
    user: process.env.PGUSER ?? 'knowledge_hub',
    password: process.env.PGPASSWORD ?? 'local-development-only',
    port: Number(process.env.PGPORT ?? process.env.POSTGRES_PORT ?? 5432),
  };
  const admin = new pg.Client({ ...config, database: process.env.PGDATABASE ?? 'knowledge_hub' });
  const db = new pg.Pool({ ...config, database });
  const poolErrors = [];
  const recordPoolError = (error) => poolErrors.push(error);
  db.on('error', recordPoolError);
  db.on('connect', (client) => client.on('error', recordPoolError));
  const origin = 'https://notes.example.test';
  let app;

  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    await migrateDatabase(db);
    process.env.PGDATABASE = database;
    process.env.PGUSER = config.user;
    process.env.PGPASSWORD = config.password;
    process.env.PGPORT = String(config.port);
    process.env.WEB_ORIGINS = origin;
    delete process.env.DATABASE_URL;
    app = await createApp(false);
    await app.listen(0, '127.0.0.1');
    const base = `${await app.getUrl()}/api/v1`;

    async function register(email) {
      const response = await fetch(`${base}/auth/register`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'synthetic password fixture' }),
      });
      assert.equal(response.status, 201);
      return {
        Cookie: response.headers.get('set-cookie').split(';')[0],
        'X-CSRF-Token': (await response.json()).csrfToken,
      };
    }

    const owner = await register('owner@example.test');
    const other = await register('other@example.test');
    const api = (path, method = 'GET', payload, session = owner) => fetch(`${base}${path}`, {
      method,
      headers: { Origin: origin, ...session, ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const request = (path = '', ...args) => api(`/notes${path}`, ...args);

    async function expectStatus(result, status) {
      const response = await result;
      const payload = await response.text();
      assert.equal(response.status, status, payload);
      return payload ? JSON.parse(payload) : undefined;
    }
    async function expectError(result, status, code) {
      const payload = await expectStatus(result, status);
      assert.deepEqual(Object.keys(payload).sort(), ['code', 'message']);
      assert.equal(payload.code, code);
    }

    await t.test('Ask validates evidence and isolates current owner notes', (subtest) =>
      checkAsk(subtest, db, register, api, expectStatus, expectError, embeddingModel()));

    if (process.env.RUN_LIVE_ASK === '1') {
      await t.test('live Ask evaluation on 20 synthetic questions', async (subtest) => {
        const session = await register('ask-live@example.test');
        const { user } = await expectStatus(api('/auth/me', 'GET', undefined, session), 200);
        await evaluateLiveAsk(subtest, db, user.id);
      });
    }

    await expectError(request('', 'GET', undefined, {}), 401, 'AUTH_REQUIRED');
    await expectError(request('', 'POST', { title: 'A note' }, { Cookie: owner.Cookie }), 403, 'CSRF_INVALID');
    await expectError(request('', 'POST', { title: 'A note' }, { ...owner, Origin: 'https://other.example.test' }), 403, 'ORIGIN_FORBIDDEN');
    await expectError(request('', 'POST'), 415, 'JSON_REQUIRED');
    assert.deepEqual(await expectStatus(request(), 200), { items: [], nextOffset: null });
    for (const invalid of [{}, { title: ' \t' }, { title: 'a'.repeat(201) }, { title: 'A', body: 'b'.repeat(5001) },
      { title: 'A', body: null }, { title: 'A', body: '\0' }, { title: '\ud800' }, { title: 'A', userId: randomUUID() }]) {
      await expectError(request('', 'POST', invalid), 422, 'INVALID_NOTE_INPUT');
    }
    for (const query of ['?limit=0', '?limit=101', '?limit=1&limit=2', '?offset=-1', '?offset=2147483648']) {
      await expectError(request(query), 422, 'INVALID_PAGINATION');
    }
    await expectError(request('/invalid'), 422, 'INVALID_NOTE_ID');

    const first = await expectStatus(request('', 'POST', { title: 'A note' }), 201);
    assert.deepEqual(first, {
      id: first.id, title: 'A note', body: '', tagIds: [], contentRevision: 1, indexingStatus: 'pending',
      createdAt: first.createdAt, updatedAt: first.createdAt,
    });
    assert.ok(Number.isFinite(Date.parse(first.createdAt)));
    const second = await expectStatus(request('', 'POST', { title: '📝'.repeat(200), body: 'a'.repeat(5000) }), 201);
    await db.query('UPDATE notes SET updated_at = $1 WHERE id IN ($2, $3)', [first.updatedAt, first.id, second.id]);
    const sortedIds = [first.id, second.id].sort();
    const page = await expectStatus(request('?limit=1'), 200);
    assert.deepEqual(page.items.map(({ id }) => id), sortedIds.slice(0, 1));
    assert.equal(page.nextOffset, 1);
    const remainder = await expectStatus(request(`?limit=1&offset=${page.nextOffset}`), 200);
    assert.deepEqual(remainder.items.map(({ id }) => id), sortedIds.slice(1));
    assert.equal(remainder.nextOffset, null);

    const path = `/${first.id}`;
    assert.deepEqual(await expectStatus(request('', 'GET', undefined, other), 200), { items: [], nextOffset: null });
    await expectError(request(path, 'GET', undefined, other), 404, 'NOT_FOUND');
    await expectError(request(path, 'PATCH', { title: 'Foreign edit' }, other), 404, 'NOT_FOUND');
    await expectError(request(path, 'DELETE', undefined, other), 404, 'NOT_FOUND');
    assert.deepEqual(await expectStatus(request(path), 200), first);
    await expectError(request(path, 'PATCH', {}), 422, 'INVALID_NOTE_INPUT');
    assert.deepEqual(await expectStatus(request(path, 'PATCH', { title: first.title }), 200), first);

    const edited = await expectStatus(request(path, 'PATCH', { body: '  Plain text\n' }), 200);
    assert.deepEqual(edited, { ...first, body: '  Plain text\n', contentRevision: 2, updatedAt: edited.updatedAt });
    assert.ok(Date.parse(edited.updatedAt) > Date.parse(first.updatedAt));
    const concurrent = await Promise.all([
      expectStatus(request(path, 'PATCH', { title: 'Renamed' }), 200),
      expectStatus(request(path, 'PATCH', { body: '' }), 200),
    ]);
    assert.deepEqual(concurrent.map(({ contentRevision }) => contentRevision).sort(), [3, 4]);
    const latest = await expectStatus(request(path), 200);
    assert.equal(latest.title, 'Renamed');
    assert.equal(latest.body, '');
    assert.equal(latest.contentRevision, 4);
    assert.deepEqual((await expectStatus(request(), 200)).items.map(({ id }) => id), [first.id, second.id]);
    const { rows: [tag] } = await db.query(`
      INSERT INTO tags (user_id, name, normalized_name)
      SELECT user_id, 'Fixture', 'fixture' FROM notes WHERE id = $1
      RETURNING id, user_id
    `, [first.id]);
    await db.query('INSERT INTO note_tags (user_id, note_id, tag_id) VALUES ($1, $2, $3)', [tag.user_id, first.id, tag.id]);
    await db.query(`
      INSERT INTO note_embeddings (note_id, content_revision, model_id, embedding) VALUES ($1, 4, 'fixture', $2)
    `, [first.id, JSON.stringify(Array(768).fill(1))]);
    await expectStatus(request(path, 'DELETE'), 204);
    assert.equal((await db.query('SELECT 1 FROM note_tags WHERE note_id = $1', [first.id])).rowCount, 0);
    assert.equal((await db.query('SELECT 1 FROM note_embeddings WHERE note_id = $1', [first.id])).rowCount, 0);
    assert.equal((await db.query('SELECT 1 FROM tags WHERE id = $1', [tag.id])).rowCount, 1);
    await expectStatus(api(`/tags/${tag.id}`, 'DELETE'), 204);
    await expectError(request(path), 404, 'NOT_FOUND');
    await expectError(request(path, 'DELETE'), 404, 'NOT_FOUND');

    const spec = await expectStatus(fetch(`${base}/openapi.json`), 200);
    const routes = spec.paths['/api/v1/notes/{id}'];
    assert.deepEqual(routes.get.security, [{ cookie: [] }]);
    assert.equal(routes.patch.requestBody.content['application/json'].schema.$ref, '#/components/schemas/UpdateNote');
    assert.ok(routes.delete.responses['204']);
    assert.ok(spec.components.schemas.Note.required.includes('body'));
    const reindex = spec.paths['/api/v1/notes/{id}/reindex'].post;
    assert.deepEqual(reindex.security, [{ cookie: [] }]);
    assert.ok(reindex.responses['204']);

    await t.test('tag CRUD, atomic assignments, and filtered pages', async () => {
      const tags = (path = '', ...args) => api(`/tags${path}`, ...args);
      const assignment = `/${second.id}/tags`;
      const replace = (tagIds, session = owner) => request(assignment, 'PUT', { tagIds }, session);
      const note = () => expectStatus(request(`/${second.id}`), 200);
      const filter = (id) => `?tagId=${id}`;

      await expectError(tags('', 'GET', undefined, {}), 401, 'AUTH_REQUIRED');
      await expectError(tags('', 'POST', { name: 'Fixture' }, { Cookie: owner.Cookie }), 403, 'CSRF_INVALID');
      for (const payload of [{}, { name: ' ' }, { name: 'a'.repeat(101) }, { name: false }, { name: 'Valid', userId: randomUUID() }]) {
        await expectError(tags('', 'POST', payload), 422, 'INVALID_TAG_INPUT');
      }
      const cafe = await expectStatus(tags('', 'POST', { name: '  Café  ' }), 201);
      assert.deepEqual(cafe, { id: cafe.id, name: 'Café', createdAt: cafe.createdAt });
      assert.ok(Number.isFinite(Date.parse(cafe.createdAt)));
      await expectError(tags('', 'POST', { name: ' CAFE\u0301 ' }), 409, 'TAG_NAME_IN_USE');
      const alpha = await expectStatus(tags('', 'POST', { name: 'Alpha' }), 201);
      const foreign = await expectStatus(tags('', 'POST', { name: 'CAFÉ' }, other), 201);
      assert.deepEqual(await expectStatus(tags(), 200), [alpha, cafe]);
      assert.deepEqual(await expectStatus(tags('', 'GET', undefined, other), 200), [foreign]);
      await expectError(tags('/invalid', 'DELETE'), 422, 'INVALID_TAG_ID');
      await expectError(tags(`/${cafe.id}`, 'PATCH', { name: ' alpha ' }), 409, 'TAG_NAME_IN_USE');
      await expectError(tags(`/${cafe.id}`, 'PATCH', { name: 'Other' }, other), 404, 'NOT_FOUND');
      await expectError(tags(`/${cafe.id}`, 'DELETE', undefined, other), 404, 'NOT_FOUND');

      const before = await note();
      await expectError(replace([cafe.id, cafe.id.toUpperCase()]), 422, 'INVALID_TAG_ASSIGNMENT');
      await expectError(replace(['invalid']), 422, 'INVALID_TAG_ASSIGNMENT');
      await expectError(replace([cafe.id], { Cookie: owner.Cookie }), 403, 'CSRF_INVALID');
      await expectError(replace([foreign.id], other), 404, 'NOT_FOUND');
      await expectStatus(replace([cafe.id.toUpperCase()]), 204);
      const assigned = { ...before, tagIds: [cafe.id] };
      assert.deepEqual(await note(), assigned);
      assert.deepEqual(await expectStatus(request(`/${second.id}`, 'PATCH', { title: before.title }), 200), assigned);
      await expectError(replace([alpha.id, foreign.id]), 404, 'NOT_FOUND');
      await expectError(replace([randomUUID()]), 404, 'NOT_FOUND');
      assert.deepEqual(await note(), assigned);

      const newer = await expectStatus(request('', 'POST', { title: 'Newer untagged note' }), 201);
      assert.deepEqual(await expectStatus(request(`${filter(cafe.id)}&limit=1`), 200), {
        items: [assigned], nextOffset: null,
      });
      await expectStatus(request(`/${newer.id}/tags`, 'PUT', { tagIds: [cafe.id] }), 204);
      const filtered = await expectStatus(request(`${filter(cafe.id)}&limit=1`), 200);
      assert.deepEqual(filtered, { items: [{ ...newer, tagIds: [cafe.id] }], nextOffset: 1 });
      assert.deepEqual(await expectStatus(request(`${filter(cafe.id)}&limit=1&offset=1`), 200), {
        items: [assigned], nextOffset: null,
      });
      await expectError(request(filter('invalid')), 422, 'INVALID_TAG_ID');
      for (const [id, session] of [[foreign.id, owner], [cafe.id, other], [randomUUID(), owner]]) {
        assert.deepEqual(await expectStatus(request(filter(id), 'GET', undefined, session), 200),
          { items: [], nextOffset: null });
      }

      const renamed = await expectStatus(tags(`/${cafe.id}`, 'PATCH', { name: ' Renamed ' }), 200);
      assert.deepEqual(renamed, { ...cafe, name: 'Renamed' });
      assert.deepEqual(await note(), assigned);
      await Promise.all([
        expectStatus(replace([alpha.id]), 204),
        expectStatus(replace([cafe.id]), 204),
      ]);
      assert.equal((await note()).tagIds.length, 1);
      await expectStatus(replace([alpha.id, cafe.id]), 204);
      assert.deepEqual((await note()).tagIds, [alpha.id, cafe.id].sort());
      await expectStatus(tags(`/${cafe.id}`, 'DELETE'), 204);
      assert.deepEqual(await note(), { ...before, tagIds: [alpha.id] });
      assert.deepEqual(await expectStatus(request(filter(cafe.id)), 200), { items: [], nextOffset: null });
      assert.deepEqual(await expectStatus(request(`/${newer.id}`), 200), newer);
      await expectStatus(replace([]), 204);
      assert.deepEqual(await note(), before);

      const tagRoutes = spec.paths['/api/v1/tags'];
      const idRoutes = spec.paths['/api/v1/tags/{id}'];
      const put = spec.paths['/api/v1/notes/{id}/tags'].put;
      assert.deepEqual(tagRoutes.get.security, [{ cookie: [] }]);
      assert.ok(tagRoutes.post.responses['409']);
      assert.ok(idRoutes.patch.responses['404']);
      assert.ok(idRoutes.delete.responses['204']);
      assert.ok(put.responses['204']);
      assert.ok(put.parameters.some(({ name, required }) => name.toLowerCase() === 'x-csrf-token' && required));
      assert.equal(put.requestBody.content['application/json'].schema.$ref, '#/components/schemas/ReplaceTags');
      assert.ok(spec.paths['/api/v1/notes'].get.parameters.some(({ name }) => name === 'tagId'));
      assert.ok(spec.components.schemas.Note.required.includes('tagIds'));
    });

    const { rows: [queue] } = await db.query('SELECT count(*)::int AS count FROM graphile_worker.jobs');
    assert.equal(queue.count, 6);

    await t.test('queue failures roll back creates and edits', async () => {
      const path = `/${second.id}`;
      const before = await expectStatus(request(path), 200);
      await db.query('ALTER SCHEMA graphile_worker RENAME TO unavailable_worker');
      try {
        await expectError(request('', 'POST', { title: 'Rolled back' }), 500, 'INTERNAL_ERROR');
        await expectError(request(path, 'PATCH', { title: 'Rolled back' }), 500, 'INTERNAL_ERROR');
      } finally {
        await db.query('ALTER SCHEMA unavailable_worker RENAME TO graphile_worker');
      }
      assert.deepEqual(await expectStatus(request(path), 200), before);
      assert.equal((await db.query("SELECT id FROM notes WHERE title = 'Rolled back'")).rowCount, 0);
    });

    await t.test('backfill, Graphile execution, retries, stale work and deletion', async () => {
      const modelId = embeddingModel();
      const { rows: [legacy] } = await db.query(`
        INSERT INTO notes (user_id, title, body) VALUES ($1, 'Legacy note', 'Synthetic body')
        RETURNING id, user_id
      `, [tag.user_id]);
      const path = `/${legacy.id}`;
      const read = () => expectStatus(request(path), 200);
      async function payload() {
        const { rows: [row] } = await db.query(`
          SELECT user_id AS "userId", id AS "noteId", content_revision AS "contentRevision",
            indexing_model AS "modelId", indexing_request AS "requestId"
          FROM notes WHERE id = $1
        `, [legacy.id]);
        return row;
      }
      const vector = Array(768).fill(0.5);
      let inference = async () => vector;
      let calls = 0;
      const provider = {
        modelId, dimensions: 768,
        async embedDocument(text) {
          calls++;
          return inference(text);
        },
      };
      const task = indexNoteTask(db, provider);
      const work = (job, attempts = 1) => task(job, { job: { attempts, max_attempts: 5 } });
      await backfillIndexing(db, modelId);
      const backfilled = await payload();
      assert.ok(backfilled.requestId);
      await backfillIndexing(db, modelId);
      assert.deepEqual(await payload(), backfilled);
      await expectError(request(`${path}/reindex`, 'POST', undefined, other), 404, 'NOT_FOUND');
      await expectError(request(`${path}/reindex`, 'POST', undefined, { Cookie: owner.Cookie }), 403, 'CSRF_INVALID');

      inference = async () => { throw new Error('Synthetic outage details'); };
      await runOnce({ pgPool: db, taskList: { 'index-note': task } });
      // runOnce can finish before Graphile's asynchronous failure update is visible.
      let retry;
      const deadline = performance.now() + 2000;
      do {
        const { rows } = await db.query('SELECT attempts, last_error FROM graphile_worker.jobs WHERE key = $1',
          [`index-note:${backfilled.requestId}`]);
        [retry] = rows;
        if (retry?.last_error) break;
        await delay(20);
      } while (performance.now() < deadline);
      assert.deepEqual(retry, { attempts: 1, last_error: 'Note indexing failed.' });
      assert.equal((await read()).indexingStatus, 'pending');

      await db.query(`
        SELECT graphile_worker.reschedule_jobs(ARRAY(SELECT id FROM graphile_worker.jobs WHERE key = $1),
          run_at := clock_timestamp())
      `, [`index-note:${backfilled.requestId}`]);
      inference = async () => vector;
      await runOnce({ pgPool: db, taskList: { 'index-note': task } });
      assert.equal((await read()).indexingStatus, 'ready');

      await expectStatus(request(`${path}/reindex`, 'POST'), 204);
      const original = await payload();
      inference = async () => [1, 2];
      await assert.rejects(work(original, 5), /Note indexing failed/);
      assert.equal((await read()).indexingStatus, 'failed');
      const beforeRetry = await read();
      await expectStatus(request(`${path}/reindex`, 'POST'), 204);
      const requested = await payload();
      assert.notEqual(requested.requestId, original.requestId);
      await expectStatus(request(`${path}/reindex`, 'POST'), 204);
      assert.deepEqual(await payload(), requested);
      assert.deepEqual(await read(), { ...beforeRetry, indexingStatus: 'pending' });

      inference = async (text) => {
        assert.equal(text, 'Legacy note\n\nSynthetic body');
        return vector;
      };
      await work(requested);
      assert.equal((await read()).indexingStatus, 'ready');
      const readyCalls = calls;
      await work(requested);
      await work(original, 5);
      assert.equal(calls, readyCalls);

      await expectStatus(request(`${path}/reindex`, 'POST'), 204);
      inference = async () => {
        await expectStatus(request(path, 'PATCH', { body: 'New revision' }), 200);
        return vector;
      };
      await work(await payload());
      const current = await read();
      assert.equal(current.indexingStatus, 'pending');
      assert.equal(current.contentRevision, 2);
      const { rows: [embedding] } = await db.query('SELECT content_revision, model_id FROM note_embeddings WHERE note_id = $1', [legacy.id]);
      assert.deepEqual(embedding, { content_revision: 1, model_id: modelId });

      inference = async () => vector;
      const previousModel = await payload();
      await backfillIndexing(db, 'synthetic-model');
      await work(previousModel);
      assert.equal((await read()).indexingStatus, 'pending');
      await assert.rejects(work(await payload()), /does not match/);
      await backfillIndexing(db, modelId);

      const exhausted = await payload();
      await db.query(`
        SELECT graphile_worker.permanently_fail_jobs(ARRAY(SELECT id FROM graphile_worker.jobs WHERE key = $1))
      `, [`index-note:${exhausted.requestId}`]);
      await reconcileFailedIndexing(db, modelId);
      assert.equal((await read()).indexingStatus, 'failed');
      await expectStatus(request(`${path}/reindex`, 'POST'), 204);
      inference = async () => {
        await expectStatus(request(path, 'DELETE'), 204);
        return vector;
      };
      await work(await payload());
      assert.equal((await db.query('SELECT 1 FROM note_embeddings WHERE note_id = $1', [legacy.id])).rowCount, 0);
    });
    assert.deepEqual(poolErrors, []);
  } finally {
    await app?.close();
    await db.end();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    } finally {
      await admin.end();
    }
  }
});
