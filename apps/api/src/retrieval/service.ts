import type pg from 'pg';
import { AiFailure } from '../ai/failure.js';
import { validEmbedding, type EmbeddingProvider } from '../indexing/embedding.js';

export const topK = 3;
export const relevanceThreshold = 0.67;

export interface RetrievedNote {
  noteId: string;
  title: string;
  body: string;
  similarity: number;
  revision: number;
  requestId: string | null;
}

const eligible = `
  FROM notes n JOIN note_embeddings e ON e.note_id = n.id
  WHERE n.user_id = $1 AND n.indexing_status = 'ready'
    AND n.indexing_model = $2 AND e.model_id = $2
    AND e.content_revision = n.content_revision
`;

export class NoteRetrieval {
  constructor(
    private readonly db: pg.Pool,
    private readonly embeddings: EmbeddingProvider,
    private readonly minimumSimilarity = relevanceThreshold,
  ) {}

  async retrieve(userId: string, question: string) {
    const scope = [userId, this.embeddings.modelId];
    const available = await this.db.query(`SELECT 1 ${eligible} LIMIT 1`, scope);
    if (!available.rowCount) return [];

    const vector = await this.embeddings.embedQuery(question);
    if (!validEmbedding(vector, this.embeddings.dimensions)) throw new AiFailure('AI_UNAVAILABLE');
    const { rows } = await this.db.query<RetrievedNote>(`
      SELECT n.id AS "noteId", n.title, n.body, n.content_revision AS revision,
             n.indexing_request AS "requestId", 1 - (e.embedding <=> $3::vector) AS similarity
      ${eligible}
        AND (e.embedding <=> $3::vector) <= $4
      ORDER BY e.embedding <=> $3::vector, n.id
      LIMIT $5
    `, [...scope, JSON.stringify(vector), 1 - this.minimumSimilarity, topK]);
    return rows;
  }

  async stillCurrent(userId: string, notes: RetrievedNote[]) {
    const { rows } = await this.db.query<Pick<RetrievedNote, 'noteId' | 'revision' | 'requestId'>>(`
      SELECT n.id AS "noteId", n.content_revision AS revision, n.indexing_request AS "requestId"
      ${eligible} AND n.id = ANY($3::uuid[])
    `, [userId, this.embeddings.modelId, notes.map(({ noteId }) => noteId)]);
    return notes.every((note) => rows.some((row) =>
      row.noteId === note.noteId && row.revision === note.revision && row.requestId === note.requestId));
  }
}
