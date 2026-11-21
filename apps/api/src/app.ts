import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

@Controller('health')
class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}

@Module({ controllers: [HealthController] })
class AppModule {}

export async function createApp(logger: false | undefined = undefined) {
  const app = await NestFactory.create(AppModule, { logger });
  app.setGlobalPrefix('api/v1');
  return app;
}
