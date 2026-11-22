import { createParamDecorator, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { performance } from 'node:perf_hooks';
import { authError, readSession, requireCsrf, requireOrigin, type BrowserPolicy } from './browser.js';
import { AuthService, type Principal } from './service.js';

export const BROWSER_POLICY = Symbol('BROWSER_POLICY');
type AuthContext = { user: Principal; token: string };
type AuthRequest = Request & { auth?: AuthContext };

@Injectable()
export class SessionGuard {
  constructor(
    private readonly auth: AuthService,
    @Inject(BROWSER_POLICY) private readonly policy: BrowserPolicy,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    context.switchToHttp().getResponse<Response>().set('Cache-Control', 'no-store');
    const writes = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (writes) requireOrigin(request, this.policy);
    const token = readSession(request, this.policy);
    const user = token && await this.auth.currentUser(token);
    if (!token || !user) throw authError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
    if (writes) requireCsrf(request, token);
    request.auth = { user, token };
    return true;
  }
}

export const CurrentSession = createParamDecorator((_data: unknown, context: ExecutionContext): AuthContext => {
  const auth = context.switchToHttp().getRequest<AuthRequest>().auth;
  if (!auth) throw authError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
  return auth;
});

@Injectable()
export class CredentialGuard {
  private readonly windows = new Map<string, { expires: number; attempts: number }>();

  constructor(@Inject(BROWSER_POLICY) private readonly policy: BrowserPolicy) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    response.set('Cache-Control', 'no-store');
    requireOrigin(request, this.policy);
    if (!request.is('application/json')) {
      throw authError(415, 'JSON_REQUIRED', 'Send an application/json request.');
    }

    const now = performance.now();
    // Windows are inserted in expiration order and never extended.
    for (const [key, window] of this.windows) {
      if (window.expires > now) break;
      this.windows.delete(key);
    }
    const key = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const window = this.windows.get(key) ?? { expires: now + 60_000, attempts: 0 };
    if (window.attempts >= 10 || (!this.windows.has(key) && this.windows.size >= 10_000)) {
      response.set('Retry-After', String(Math.ceil((window.expires - now) / 1000)));
      throw authError(429, 'RATE_LIMITED', 'Too many authentication attempts.');
    }
    window.attempts++;
    this.windows.set(key, window);
    return true;
  }
}
