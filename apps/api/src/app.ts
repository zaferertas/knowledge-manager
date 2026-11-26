import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { type ArgumentsHost, Catch, Controller, Get, HttpException, Inject, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiResponse, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import type pg from 'pg';
import { authError, type BrowserPolicy, csrfHeader } from './auth/browser.js';
import { BROWSER_POLICY } from './auth/guards.js';
import { AuthModule } from './auth/module.js';
import { AUTH_DB } from './auth/service.js';
import { NotesModule } from './notes/module.js';
import { AskModule } from './qa/module.js';

@Controller('health')
class HealthController {
  constructor(@Inject(AUTH_DB) private readonly db: pg.Pool) {}

  @Get()
  @ApiResponse({ status: 200, schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['ok'] } } } })
  check() {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiResponse({ status: 200, schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['ready'] } } } })
  @ApiResponse({ status: 503, schema: { type: 'object', required: ['code', 'message'], properties: {
    code: { type: 'string', enum: ['DATABASE_UNAVAILABLE'] }, message: { type: 'string' },
  } } })
  async ready() {
    try {
      const check = {
        text: 'SELECT 1 FROM notes, note_embeddings, graphile_worker.jobs LIMIT 0',
        query_timeout: 3000,
      };
      await this.db.query(check);
      return { status: 'ready' };
    } catch {
      throw authError(503, 'DATABASE_UNAVAILABLE', 'The database is unavailable or migrations are incomplete.');
    }
  }
}

@Module({ imports: [AuthModule, NotesModule, AskModule], controllers: [HealthController] })
class AppModule {}

const errors: Record<number, { code: string; message: string }> = {
  400: { code: 'BAD_REQUEST', message: 'The request could not be read.' },
  404: { code: 'NOT_FOUND', message: 'Resource not found.' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Request media type is unsupported.' },
  500: { code: 'INTERNAL_ERROR', message: 'An internal error occurred.' },
};

@Catch()
class ApiErrorFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return response.end();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const body = error instanceof HttpException ? error.getResponse() : undefined;
    const payload = typeof body === 'object' && 'code' in body && 'message' in body
      ? body : errors[status] ?? errors[500];
    response.locals.errorCode = payload.code;
    response.set('Cache-Control', 'no-store').status(status).json(payload);
  }
}

export async function createApp(logger: false | undefined = undefined) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false, abortOnError: false, bodyParser: false,
  });
  const policy = app.get<BrowserPolicy>(BROWSER_POLICY);
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiErrorFilter());
  app.use((_request: Request, response: Response, next: NextFunction) => {
    const requestId = randomUUID();
    const started = performance.now();
    response.set('X-Request-Id', requestId);
    if (logger !== false) {
      response.on('finish', () => console.info(JSON.stringify({
        event: 'api_request', requestId, status: response.statusCode,
        code: response.locals.errorCode, durationMs: Math.round(performance.now() - started),
      })));
    }
    next();
  });
  app.enableCors({
    origin: policy.origins,
    credentials: true,
    allowedHeaders: ['Content-Type', csrfHeader],
    exposedHeaders: ['Retry-After', 'X-Request-Id'],
  });
  app.useBodyParser('json', { limit: '64kb' });
  SwaggerModule.setup('openapi', app, () => openApiDocument(app), {
    useGlobalPrefix: true, ui: false, raw: ['json'], jsonDocumentUrl: 'openapi.json',
  });
  return app;
}

export function openApiDocument(app: NestExpressApplication) {
  const policy = app.get<BrowserPolicy>(BROWSER_POLICY);
  const settings = new DocumentBuilder().setTitle('Personal Knowledge Hub API').setVersion('1')
    .addCookieAuth(policy.cookieName).build();
  return SwaggerModule.createDocument(app, settings);
}
