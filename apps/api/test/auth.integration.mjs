import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { migrateDatabase } from '../../../packages/database/migrate.mjs';
import { createApp } from '../dist/app.js';

test('browser authentication persists isolated, expiring, revocable sessions in PostgreSQL', async () => {
  const database = `knowledge_hub_auth_${randomUUID().replaceAll('-', '')}`;
  const config = {
    user: process.env.PGUSER ?? 'knowledge_hub',
    password: process.env.PGPASSWORD ?? 'local-development-only',
    port: Number(process.env.PGPORT ?? process.env.POSTGRES_PORT ?? 5432),
  };
  const admin = new pg.Client({ ...config, database: process.env.PGDATABASE ?? 'knowledge_hub' });
  await admin.connect();
  const origin = 'https://notes.example.test';
  const db = new pg.Pool({ ...config, database });
  const poolErrors = [];
  const recordPoolError = (error) => poolErrors.push(error);
  db.on('error', recordPoolError);
  db.on('connect', (client) => client.on('error', recordPoolError));
  let app;
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
    const base = await app.getUrl();

    const request = (path, { method = 'GET', headers, body } = {}) =>
      fetch(`${base}/api/v1/${path}`, { method, headers, body });
    const credentials = { email: 'Owner@Example.Test ', password: 'synthetic password fixture' };
    const post = (path, body = credentials, source = origin) => request(`auth/${path}`, {
      method: 'POST',
      headers: { Origin: source, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const expectError = async (result, status, code) => {
      const response = await result;
      assert.equal(response.status, status);
      const payload = await response.json();
      assert.deepEqual(Object.keys(payload).sort(), ['code', 'message']);
      assert.equal(payload.code, code);
      return payload;
    };

    const options = (source) => request('auth/login', {
      method: 'OPTIONS',
      headers: { Origin: source, 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, X-CSRF-Token' },
    });
    const preflight = await options(origin);
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
    assert.match(preflight.headers.get('access-control-allow-headers'), /x-csrf-token/i);
    assert.equal((await options('https://foreign.example.test')).headers.get('access-control-allow-origin'), null);
    await expectError(post('register', credentials, 'https://foreign.example.test'), 403, 'ORIGIN_FORBIDDEN');
    await expectError(request('auth/login', { method: 'POST' }), 403, 'ORIGIN_FORBIDDEN');
    await expectError(request('auth/login', { method: 'POST', headers: { Origin: origin }, body: 'email=fixture' }),
      415, 'JSON_REQUIRED');
    await expectError(request('auth/login', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{',
    }), 400, 'BAD_REQUEST');
    await expectError(request('auth/login', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'x'.repeat(65_536) }),
    }), 413, 'PAYLOAD_TOO_LARGE');

    await expectError(post('register', { ...credentials, password: 'short' }), 422, 'INVALID_CREDENTIAL_INPUT');
    await expectError(request('auth/me'), 401, 'AUTH_REQUIRED');
    const registration = await post('register');
    assert.equal(registration.status, 201);
    assert.equal(registration.headers.get('cache-control'), 'no-store');
    const header = registration.headers.get('set-cookie');
    assert.match(header, /^__Host-kh_session=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/);
    const ownerCookie = header.split(';')[0];
    const owner = await registration.json();
    assert.equal(owner.user.email, 'owner@example.test');
    assert.deepEqual(Object.keys(owner.user).sort(), ['email', 'id']);
    assert.match(owner.csrfToken, /^[\w-]{43}$/);

    const { rows: [stored] } = await db.query(`
      SELECT password_hash, token_hash FROM users JOIN sessions ON users.id = sessions.user_id
      WHERE users.id = $1
    `, [owner.user.id]);
    assert.match(stored.password_hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    const hashCookie = (cookie) => createHash('sha256').update(cookie.split('=')[1]).digest('hex');
    assert.equal(stored.token_hash, hashCookie(ownerCookie));
    await expectError(post('register'), 409, 'EMAIL_IN_USE');

    const wrong = await expectError(post('login', { ...credentials, password: 'wrong synthetic password' }),
      401, 'INVALID_CREDENTIALS');
    const unknown = await expectError(post('login', { ...credentials, email: 'missing@example.test' }),
      401, 'INVALID_CREDENTIALS');
    assert.deepEqual(wrong, unknown);
    const login = await post('login');
    assert.equal(login.status, 200);
    const signedIn = await login.json();
    const loginCookie = login.headers.get('set-cookie').split(';')[0];
    assert.deepEqual(signedIn.user, owner.user);
    assert.notEqual(loginCookie, ownerCookie);

    const secondRegistration = await post('register', { ...credentials, email: 'other@example.test' });
    assert.equal(secondRegistration.status, 201);
    const other = await secondRegistration.json();
    const otherCookie = secondRegistration.headers.get('set-cookie').split(';')[0];
    assert.notEqual(other.user.id, owner.user.id);
    const me = (cookie, query = '') => request(`auth/me${query}`, { headers: { Cookie: cookie } });
    assert.deepEqual(await (await me(otherCookie, `?userId=${owner.user.id}`)).json(), other);
    assert.deepEqual(await (await me(ownerCookie)).json(), owner);

    const logout = (cookie, token, source = origin) => request('auth/logout', {
      method: 'POST', headers: { Cookie: cookie, Origin: source, ...(token ? { 'X-CSRF-Token': token } : {}) },
    });
    await expectError(logout(ownerCookie, owner.csrfToken, 'https://foreign.example.test'), 403, 'ORIGIN_FORBIDDEN');
    await expectError(logout(ownerCookie), 403, 'CSRF_INVALID');
    await expectError(logout(ownerCookie, other.csrfToken), 403, 'CSRF_INVALID');
    const loggedOut = await logout(ownerCookie, owner.csrfToken);
    assert.equal(loggedOut.status, 204);
    assert.match(loggedOut.headers.get('set-cookie'), /Max-Age=0; Secure$/);
    await expectError(me(ownerCookie), 401, 'AUTH_REQUIRED');
    assert.deepEqual(await (await me(otherCookie)).json(), other);
    assert.deepEqual(await (await me(loginCookie)).json(), signedIn);

    const expired = await db.query('UPDATE sessions SET expires_at = now() WHERE token_hash = $1', [hashCookie(loginCookie)]);
    assert.equal(expired.rowCount, 1);
    await expectError(me(loginCookie), 401, 'AUTH_REQUIRED');

    for (let attempt = 0; attempt < 3; attempt++) {
      await expectError(post('login', {}), 422, 'INVALID_CREDENTIAL_INPUT');
    }
    const limited = await post('login', {});
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    await expectError(limited, 429, 'RATE_LIMITED');

    const openapi = await request('openapi.json');
    assert.equal(openapi.status, 200);
    const spec = await openapi.json();
    assert.equal(spec.components.securitySchemes.cookie.name, '__Host-kh_session');
    assert.deepEqual(spec.paths['/api/v1/auth/me'].get.security, [{ cookie: [] }]);
    assert.ok(spec.paths['/api/v1/auth/login'].post.responses['429']);
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
