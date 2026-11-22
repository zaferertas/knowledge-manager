import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/module.js';
import { TagsModule } from '../tags/module.js';
import { NotesController } from './controller.js';
import { NotesService } from './service.js';

@Module({ imports: [AuthModule, TagsModule], controllers: [NotesController], providers: [NotesService] })
export class NotesModule {}
