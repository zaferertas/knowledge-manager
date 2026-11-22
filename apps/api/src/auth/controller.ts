import {
  Body, Controller, Get, HttpCode, Inject, Post, Res, UseGuards, applyDecorators,
} from '@nestjs/common';
import {
  ApiBody, ApiCookieAuth, ApiHeader, ApiOperation, ApiProperty, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  authError, csrfHeader, csrfToken, sessionCookie, sessionLifetimeSeconds, type BrowserPolicy,
} from './browser.js';
import { BROWSER_POLICY, CredentialGuard, CurrentSession, SessionGuard } from './guards.js';
import { AuthService, type Principal } from './service.js';

class Credentials {
  @ApiProperty({ format: 'email', maxLength: 254, description: 'Trimmed and lowercased.' })
  email!: string;

  @ApiProperty({ format: 'password', minLength: 12, description: 'At most 256 UTF-8 bytes.' })
  password!: string;
}

class Account {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;
}

class Session {
  @ApiProperty({ type: Account })
  user!: Account;

  @ApiProperty({ pattern: '^[A-Za-z0-9_-]{43}$', description: 'Send in X-CSRF-Token for authenticated writes.' })
  csrfToken!: string;
}

class ErrorResponse {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  message!: string;
}

function credentials(body: unknown): Credentials {
  if (body && typeof body === 'object' && 'email' in body && 'password' in body &&
    typeof body.email === 'string' && typeof body.password === 'string') {
    const email = body.email.trim().toLowerCase();
    if (email.length <= 254 && /^[^\s@\p{Cc}]+@[^\s@\p{Cc}]+\.[^\s@\p{Cc}]+$/u.test(email) &&
      [...body.password].length >= 12 && Buffer.byteLength(body.password) <= 256) {
      return { email, password: body.password };
    }
  }
  throw authError(422, 'INVALID_CREDENTIAL_INPUT', 'Provide a valid email and a password of at least 12 characters and at most 256 UTF-8 bytes.');
}

function credentialRoute(status: number) {
  return applyDecorators(
    UseGuards(CredentialGuard),
    ApiHeader({ name: 'Origin', required: true }),
    ApiBody({ type: Credentials }),
    ApiResponse({ status, type: Session, headers: { 'Set-Cookie': { schema: { type: 'string' } } } }),
    ApiResponse({ status: 400, type: ErrorResponse, description: 'BAD_REQUEST' }),
    ApiResponse({ status: 403, type: ErrorResponse, description: 'ORIGIN_FORBIDDEN' }),
    ApiResponse({ status: 413, type: ErrorResponse, description: 'PAYLOAD_TOO_LARGE' }),
    ApiResponse({ status: 415, type: ErrorResponse, description: 'JSON_REQUIRED or UNSUPPORTED_MEDIA_TYPE' }),
    ApiResponse({ status: 422, type: ErrorResponse, description: 'INVALID_CREDENTIAL_INPUT' }),
    ApiResponse({ status: 429, type: ErrorResponse, description: 'RATE_LIMITED' }),
  );
}

@ApiTags('auth')
@ApiResponse({ status: 500, type: ErrorResponse, description: 'INTERNAL_ERROR' })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(BROWSER_POLICY) private readonly policy: BrowserPolicy,
  ) {}

  @Post('register')
  @credentialRoute(201)
  @ApiOperation({ summary: 'Create an account and start a session' })
  @ApiResponse({ status: 409, type: ErrorResponse, description: 'EMAIL_IN_USE' })
  async register(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const { email, password } = credentials(body);
    return this.startSession(response, await this.auth.register(email, password));
  }

  @Post('login')
  @HttpCode(200)
  @credentialRoute(200)
  @ApiOperation({ summary: 'Start a session' })
  @ApiResponse({ status: 401, type: ErrorResponse, description: 'INVALID_CREDENTIALS' })
  async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const { email, password } = credentials(body);
    return this.startSession(response, await this.auth.login(email, password));
  }

  @Get('me')
  @UseGuards(SessionGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Read the current account and session CSRF token' })
  @ApiResponse({ status: 200, type: Session })
  @ApiResponse({ status: 401, type: ErrorResponse, description: 'AUTH_REQUIRED' })
  me(@CurrentSession() { user, token }: { user: Principal; token: string }): Session {
    return { user, csrfToken: csrfToken(token) };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Revoke the current session' })
  @ApiHeader({ name: 'Origin', required: true })
  @ApiHeader({ name: csrfHeader, required: true })
  @ApiResponse({ status: 204, headers: { 'Set-Cookie': { schema: { type: 'string' } } } })
  @ApiResponse({ status: 401, type: ErrorResponse, description: 'AUTH_REQUIRED' })
  @ApiResponse({ status: 403, type: ErrorResponse, description: 'ORIGIN_FORBIDDEN or CSRF_INVALID' })
  async logout(
    @CurrentSession() { user, token }: { user: Principal; token: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(user.id, token);
    response.set('Set-Cookie', sessionCookie(this.policy, '', 0));
  }

  private startSession(response: Response, { user, token }: { user: Principal; token: string }): Session {
    response.set('Set-Cookie', sessionCookie(this.policy, token, sessionLifetimeSeconds));
    return { user, csrfToken: csrfToken(token) };
  }
}
