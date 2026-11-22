import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/module.js';
import { TagsController } from './controller.js';
import { TagsService } from './service.js';

@Module({ imports: [AuthModule], controllers: [TagsController], providers: [TagsService], exports: [TagsService] })
export class TagsModule {}
