import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ollamaEmbeddingProvider } from '../dist/indexing/embedding.js';

test('Ollama adapter formats inputs, rejects truncation, and validates vectors', async (t) => {
  const vector = Array(768).fill(0.25);
  const inputs = [];
  let output = { embeddings: [vector] };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.pathname, '/api/embed');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    const { input, model, truncate } = JSON.parse(options.body);
    assert.equal(model, 'nomic-embed-text');
    assert.equal(truncate, false);
    inputs.push(input);
    return Response.json(output);
  });
  const provider = ollamaEmbeddingProvider();
  assert.deepEqual(await provider.embedDocument('Synthetic document'), vector);
  assert.deepEqual(await provider.embedQuery('Synthetic question'), vector);
  assert.deepEqual(inputs, ['search_document: Synthetic document', 'search_query: Synthetic question']);
  for (const invalid of [[1, 2], Array(768).fill(0), Array(768).fill(1e100)]) {
    output = { embeddings: [invalid] };
    await assert.rejects(provider.embedDocument('Synthetic invalid vector'), /Ollama embedding failed/);
  }
});
