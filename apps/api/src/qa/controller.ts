import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiExtraModels, ApiProperty, ApiResponse, ApiTags, getSchemaPath } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { authError } from '../auth/browser.js';
import { ErrorResponse } from '../auth/controller.js';
import { CurrentSession, SessionGuard } from '../auth/guards.js';
import type { Principal } from '../auth/service.js';
import { validText } from '../common/input.js';
import { jsonWriteRoute, requireJson } from '../common/write-route.js';
import { AskService } from './service.js';

const maxQuestionLength = 500;

class AskQuestion {
  @ApiProperty({ minLength: 1, maxLength: maxQuestionLength })
  question!: string;
}

class AskSource {
  @ApiProperty({ format: 'uuid' })
  noteId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ maxLength: 400 })
  excerpt!: string;
}

class Answered {
  @ApiProperty({ enum: ['answered'] })
  status!: 'answered';

  @ApiProperty()
  answer!: string;

  @ApiProperty({ type: [AskSource], minItems: 1, maxItems: 3 })
  sources!: AskSource[];
}

class InsufficientEvidence {
  @ApiProperty({ enum: ['insufficient_evidence'] })
  status!: 'insufficient_evidence';

  @ApiProperty({ type: 'string', nullable: true, enum: [null] })
  answer!: null;

  @ApiProperty({ type: [AskSource], maxItems: 0 })
  sources!: [];
}

@ApiTags('ask')
@ApiCookieAuth()
@ApiExtraModels(Answered, InsufficientEvidence)
@UseGuards(SessionGuard)
@Controller('ask')
export class AskController {
  private readonly windows = new Map<string, { expires: number; attempts: number }>();

  constructor(private readonly service: AskService) {}

  @Post()
  @HttpCode(200)
  @jsonWriteRoute(AskQuestion)
  @ApiResponse({ status: 200, schema: { oneOf: [
    { $ref: getSchemaPath(Answered) }, { $ref: getSchemaPath(InsufficientEvidence) },
  ] } })
  @ApiResponse({ status: 401, type: ErrorResponse, description: 'AUTH_REQUIRED' })
  @ApiResponse({ status: 422, type: ErrorResponse, description: 'INVALID_QUESTION' })
  @ApiResponse({ status: 429, type: ErrorResponse, description: 'RATE_LIMITED' })
  @ApiResponse({ status: 503, type: ErrorResponse, description: 'AI_UNAVAILABLE or AI_TIMEOUT' })
  ask(
    @CurrentSession() { user }: { user: Principal }, @Req() request: Request,
    @Res({ passthrough: true }) response: Response, @Body() body: unknown,
  ) {
    requireJson(request);
    if (!body || typeof body !== 'object' || Object.keys(body).length !== 1 ||
      !('question' in body) || !validText(body.question, maxQuestionLength) || !body.question.trim()) {
      throw authError(422, 'INVALID_QUESTION', 'Enter a question of up to 500 characters.');
    }

    const now = performance.now();
    for (const [key, window] of this.windows) {
      if (window.expires > now) break;
      this.windows.delete(key);
    }
    const window = this.windows.get(user.id) ?? { expires: now + 60_000, attempts: 0 };
    if (window.attempts >= 10 || (!this.windows.has(user.id) && this.windows.size >= 10_000)) {
      response.set('Retry-After', String(Math.ceil((window.expires - now) / 1000)));
      throw authError(429, 'RATE_LIMITED', 'Too many questions. Try again shortly.');
    }
    window.attempts++;
    this.windows.set(user.id, window);
    return this.service.ask(user.id, body.question.trim());
  }
}
