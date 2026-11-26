import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import type { AnswerGenerator } from '../ai/answer.js';
import { AiFailure } from '../ai/failure.js';
import { authError } from '../auth/browser.js';
import { AUTH_DB } from '../auth/service.js';
import type { EmbeddingProvider } from '../indexing/embedding.js';
import { NoteRetrieval } from '../retrieval/service.js';
import { validatedEvidence } from './evidence.js';

export const ANSWER_GENERATOR = Symbol('ANSWER_GENERATOR');
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

const insufficient = { status: 'insufficient_evidence', answer: null, sources: [] } as const;

@Injectable()
export class AskService {
  private readonly retrieval: NoteRetrieval;
  private active = 0;

  constructor(
    @Inject(AUTH_DB) db: pg.Pool,
    @Inject(EMBEDDING_PROVIDER) embeddings: EmbeddingProvider,
    @Inject(ANSWER_GENERATOR) private readonly generator: AnswerGenerator,
  ) {
    this.retrieval = new NoteRetrieval(db, embeddings);
  }

  async ask(userId: string, question: string) {
    if (this.active >= 2) {
      throw authError(503, 'AI_UNAVAILABLE', 'The AI service is busy. Try again shortly.');
    }
    this.active++;
    try {
      const notes = await this.retrieval.retrieve(userId, question);
      if (!notes.length) return insufficient;

      const context = notes.map(({ noteId, title, body }) => ({
        noteId, title, content: [...body].slice(0, 1000).join(''),
      }));
      const output = await this.generator.generateAnswer({ question, sources: context });
      const sources = validatedEvidence(output, context);
      if (!sources.length || !await this.retrieval.stillCurrent(userId, notes)) return insufficient;

      return { status: 'answered', answer: sources.map(({ excerpt }) => excerpt.trim()).join('\n\n'), sources };
    } catch (error) {
      if (!(error instanceof AiFailure)) throw error;
      if (error.code === 'AI_TIMEOUT') {
        throw authError(503, error.code, 'The AI service timed out. Try again.');
      }
      throw authError(503, error.code, 'The AI service is unavailable. Try again.');
    } finally {
      this.active--;
    }
  }
}
