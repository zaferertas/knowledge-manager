import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { migrateDatabase } from '../../../packages/database/migrate.mjs';
import { createApp } from '../dist/app.js';

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
    assert.equal(queue.count, 0);
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
