import { applyDecorators, type Type } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { authError, csrfHeader } from '../auth/browser.js';
import { ErrorResponse } from '../auth/controller.js';

export function writeRoute() {
  return applyDecorators(
    ApiHeader({ name: 'Origin', required: true }),
    ApiHeader({ name: csrfHeader, required: true }),
    ApiResponse({ status: 403, type: ErrorResponse, description: 'ORIGIN_FORBIDDEN or CSRF_INVALID' }),
  );
}

export function jsonWriteRoute(type: Type<unknown>) {
  return applyDecorators(
    writeRoute(),
    ApiBody({ type }),
    ApiResponse({ status: 400, type: ErrorResponse, description: 'BAD_REQUEST' }),
    ApiResponse({ status: 413, type: ErrorResponse, description: 'PAYLOAD_TOO_LARGE' }),
    ApiResponse({ status: 415, type: ErrorResponse, description: 'JSON_REQUIRED or UNSUPPORTED_MEDIA_TYPE' }),
  );
}

export function requireJson(request: Request) {
  if (!request.is('application/json')) {
    throw authError(415, 'JSON_REQUIRED', 'Send an application/json request.');
  }
}
