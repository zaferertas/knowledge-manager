import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../dist/app.js';

test('API exposes its liveness at GET /api/v1/health', async (context) => {
  const app = await createApp(false);
  context.after(() => app.close());
  await app.listen(0, '127.0.0.1');

  const response = await fetch(new URL('/api/v1/health', await app.getUrl()));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('API logs a request ID and safe error metadata without request content', async (context) => {
  const log = context.mock.method(console, 'info', () => {});
  const app = await createApp();
  context.after(() => app.close());
  await app.listen(0, '127.0.0.1');

  const response = await fetch(new URL('/api/v1/health?fixture=private-query', await app.getUrl()), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'fixture=private-cookie' },
    body: '{ "note": "private-note"',
  });
  assert.equal(response.status, 400);
  assert.equal(log.mock.callCount(), 1);
  const entry = JSON.parse(log.mock.calls[0].arguments[0]);
  assert.deepEqual(entry, {
    event: 'api_request',
    requestId: response.headers.get('x-request-id'),
    status: 400,
    code: 'BAD_REQUEST',
    durationMs: entry.durationMs,
  });
  assert.match(entry.requestId, /^[0-9a-f-]{36}$/);
  assert.ok(Number.isInteger(entry.durationMs) && entry.durationMs >= 0);
});
