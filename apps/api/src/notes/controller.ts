import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Put, Req, UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../auth/controller.js';
import { CurrentSession, SessionGuard } from '../auth/guards.js';
import type { Principal } from '../auth/service.js';
import { jsonWriteRoute, requireJson, writeRoute } from '../common/write-route.js';
import { ReplaceTags, replacementTagIds, tagId } from '../tags/dto.js';
import { TagsService } from '../tags/service.js';
import { CreateNote, Note, NotePage, UpdateNote, defaultLimit, maxLimit, maxOffset, noteId, noteInput, pageNumber } from './dto.js';
import { NotesService } from './service.js';

@ApiTags('notes')
@ApiCookieAuth()
@ApiResponse({ status: 401, type: ErrorResponse, description: 'AUTH_REQUIRED' })
@ApiResponse({ status: 500, type: ErrorResponse, description: 'INTERNAL_ERROR' })
@UseGuards(SessionGuard)
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService, private readonly tags: TagsService) {}

  @Post()
  @jsonWriteRoute(CreateNote)
  @ApiResponse({ status: 201, type: Note })
  @ApiResponse({ status: 422, type: ErrorResponse, description: 'INVALID_NOTE_INPUT' })
  create(@CurrentSession() { user }: { user: Principal }, @Req() request: Request, @Body() body: unknown) {
    requireJson(request);
    const input = noteInput(body, false);
    return this.notes.create(user.id, input.title, input.body);
  }

  @Get()
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: maxLimit, default: defaultLimit } })
  @ApiQuery({ name: 'offset', required: false, schema: { type: 'integer', minimum: 0, maximum: maxOffset, default: 0 } })
  @ApiQuery({ name: 'tagId', required: false, schema: { type: 'string', format: 'uuid' },
    description: 'Filter by an assigned tag. Unavailable tags return an empty page.' })
  @ApiResponse({ status: 200, type: NotePage })
  @ApiResponse({ status: 422, type: ErrorResponse, description: 'INVALID_PAGINATION or INVALID_TAG_ID' })
  list(
    @CurrentSession() { user }: { user: Principal }, @Query('limit') limit: unknown,
    @Query('offset') offset: unknown, @Query('tagId') filter: unknown,
  ) {
    return this.notes.list(user.id, pageNumber(limit, defaultLimit, 1, maxLimit),
      pageNumber(offset, 0, 0, maxOffset), filter === undefined ? undefined : tagId(filter));
  }

  @Get(':id')
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiResponse({ status: 200, type: Note })
  @ApiResponse({ status: 404, type: ErrorResponse, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorResponse, description: 'INVALID_NOTE_ID' })
  read(@CurrentSession() { user }: { user: Principal }, @Param('id') id: string) {
    return this.notes.read(user.id, noteId(id));
  }

  @Patch(':id')
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @jsonWriteRoute(UpdateNote)
  @ApiResponse({ status: 200, type: Note })
  @ApiResponse({ status: 404, type: ErrorResponse, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorResponse, description: 'INVALID_NOTE_ID or INVALID_NOTE_INPUT' })
  update(
    @CurrentSession() { user }: { user: Principal }, @Param('id') id: string,
    @Req() request: Request, @Body() body: unknown,
  ) {
    requireJson(request);
    const input = noteInput(body, true);
    return this.notes.update(user.id, noteId(id), input.title, input.body);
  }

  @Put(':id/tags')
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @HttpCode(204)
  @jsonWriteRoute(ReplaceTags)
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, type: ErrorResponse, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorResponse, description: 'INVALID_NOTE_ID or INVALID_TAG_ASSIGNMENT' })
  replaceTags(
    @CurrentSession() { user }: { user: Principal }, @Param('id') id: string,
    @Req() request: Request, @Body() body: unknown,
  ) {
    requireJson(request);
    return this.tags.replaceForNote(user.id, noteId(id), replacementTagIds(body));
  }

  @Delete(':id')
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @HttpCode(204)
  @writeRoute()
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, type: ErrorResponse, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorResponse, description: 'INVALID_NOTE_ID' })
  delete(@CurrentSession() { user }: { user: Principal }, @Param('id') id: string) {
    return this.notes.delete(user.id, noteId(id));
  }
}
