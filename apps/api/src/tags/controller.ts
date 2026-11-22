import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../auth/controller.js';
import { CurrentSession, SessionGuard } from '../auth/guards.js';
import type { Principal } from '../auth/service.js';
import { jsonWriteRoute, requireJson, writeRoute } from '../common/write-route.js';
import { Tag, TagInput, tagId, tagName } from './dto.js';
import { TagsService } from './service.js';

@ApiTags('tags')
@ApiCookieAuth()
@ApiResponse({ status: 401, type: ErrorResponse, description: 'AUTH_REQUIRED' })
@ApiResponse({ status: 500, type: ErrorResponse, description: 'INTERNAL_ERROR' })
@UseGuards(SessionGuard)
@Controller('tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  @ApiResponse({ status: 200, type: [Tag] })
  list(@CurrentSession() { user }: { user: Principal }) {
    return this.tags.list(user.id);
  }

  @Post()
  @jsonWriteRoute(TagInput)
  @ApiResponse({ status: 201, type: Tag })
  @ApiResponse({ status: 409, type: ErrorResponse, description: 'TAG_NAME_IN_USE' })
  @ApiResponse({ status: 422, type: ErrorResponse, description: 'INVALID_TAG_INPUT' })
  create(@CurrentSession() { user }: { user: Principal }, @Req() request: Request, @Body() body: unknown) {
    requireJson(request);
    const { name, normalizedName } = tagName(body);
    return this.tags.create(user.id, name, normalizedName);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @jsonWriteRoute(TagInput)
  @ApiResponse({ status: 200, type: Tag })
  @ApiResponse({ status: 404, type: ErrorResponse, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorResponse, description: 'TAG_NAME_IN_USE' })
  @ApiResponse({ status: 422, type: ErrorResponse, description: 'INVALID_TAG_ID or INVALID_TAG_INPUT' })
  rename(
    @CurrentSession() { user }: { user: Principal }, @Param('id') id: string,
    @Req() request: Request, @Body() body: unknown,
  ) {
    requireJson(request);
    const { name, normalizedName } = tagName(body);
    return this.tags.rename(user.id, tagId(id), name, normalizedName);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @HttpCode(204)
  @writeRoute()
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, type: ErrorResponse, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorResponse, description: 'INVALID_TAG_ID' })
  delete(@CurrentSession() { user }: { user: Principal }, @Param('id') id: string) {
    return this.tags.delete(user.id, tagId(id));
  }
}
