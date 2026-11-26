import { Module } from '@nestjs/common';
import { ollamaAnswerGenerator } from '../ai/answer.js';
import { AuthModule } from '../auth/module.js';
import { ollamaEmbeddingProvider } from '../indexing/embedding.js';
import { AskController } from './controller.js';
import { ANSWER_GENERATOR, AskService, EMBEDDING_PROVIDER } from './service.js';

@Module({
  imports: [AuthModule],
  controllers: [AskController],
  providers: [
    AskService,
    { provide: EMBEDDING_PROVIDER, useFactory: () => ollamaEmbeddingProvider() },
    { provide: ANSWER_GENERATOR, useFactory: () => ollamaAnswerGenerator() },
  ],
})
export class AskModule {}
