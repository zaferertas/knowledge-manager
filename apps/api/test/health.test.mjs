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
