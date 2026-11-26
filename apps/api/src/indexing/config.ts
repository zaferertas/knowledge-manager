export const defaultEmbeddingModel = 'nomic-embed-text';
export const embeddingDimensions = 768;

export function embeddingModel() {
  const model = process.env.EMBEDDING_MODEL ?? defaultEmbeddingModel;
  if (!model.trim()) throw new Error('EMBEDDING_MODEL must be nonblank.');
  return model;
}
