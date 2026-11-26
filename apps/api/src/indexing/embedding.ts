import { embeddingDimensions, embeddingModel } from './config.js';

export interface EmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number;
  embedDocument(text: string): Promise<number[]>;
  embedQuery(text: string): Promise<number[]>;
}

export function validEmbedding(value: unknown, dimensions: number): value is number[] {
  return Array.isArray(value) && value.length === dimensions &&
    value.every((component) => typeof component === 'number' && Number.isFinite(Math.fround(component))) &&
    value.some((component) => Math.fround(component) !== 0);
}

export function ollamaEmbeddingProvider(): EmbeddingProvider {
  const modelId = embeddingModel();
  const dimensions = Number(process.env.EMBEDDING_DIMENSIONS ?? embeddingDimensions);
  if (dimensions !== embeddingDimensions) throw new Error('EMBEDDING_DIMENSIONS must match vector(768).');
  const endpoint = new URL('/api/embed', process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434');

  async function embed(input: string) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId, input, truncate: false }),
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      });
      if (response.ok) {
        const { embeddings } = await response.json();
        if (Array.isArray(embeddings) && embeddings.length === 1 &&
          validEmbedding(embeddings[0], dimensions)) return embeddings[0];
      }
    } catch {
      // Keep endpoint details, model responses and submitted text out of job errors.
    }
    throw new Error('Ollama embedding failed.');
  }

  return {
    modelId,
    dimensions,
    embedDocument: (text) => embed(`search_document: ${text}`),
    embedQuery: (text) => embed(`search_query: ${text}`),
  };
}
