import 'reflect-metadata';
import { type ArgumentsHost, Catch, Controller, Get, HttpException, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Response } from 'express';
import { type BrowserPolicy, csrfHeader } from './auth/browser.js';
import { BROWSER_POLICY } from './auth/guards.js';
import { AuthModule } from './auth/module.js';

@Controller('health')
class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}

@Module({ imports: [AuthModule], controllers: [HealthController] })
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
    if (status >= 500) console.error('API request failed.', { status });
    response.set('Cache-Control', 'no-store').status(status).json(payload);
  }
}

export async function createApp(logger: false | undefined = undefined) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger, abortOnError: false, bodyParser: false,
  });
  const policy = app.get<BrowserPolicy>(BROWSER_POLICY);
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableCors({
    origin: policy.origins,
    credentials: true,
    allowedHeaders: ['Content-Type', csrfHeader],
    exposedHeaders: ['Retry-After'],
  });
  app.useBodyParser('json', { limit: '64kb' });
  const settings = new DocumentBuilder().setTitle('Personal Knowledge Hub API').setVersion('1')
    .addCookieAuth(policy.cookieName).build();
  SwaggerModule.setup('openapi', app, () => SwaggerModule.createDocument(app, settings), {
    useGlobalPrefix: true, ui: false, raw: ['json'], jsonDocumentUrl: 'openapi.json',
  });
  return app;
}
