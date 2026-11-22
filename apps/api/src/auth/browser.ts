import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { Request } from 'express';

export const sessionLifetimeSeconds = 7 * 24 * 60 * 60;
export const csrfHeader = 'x-csrf-token';

export function browserPolicy(env: NodeJS.ProcessEnv) {
  const configured = env.WEB_ORIGINS ?? (env.NODE_ENV === 'production'
    ? '' : 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173');
  const origins = configured.split(',').map((entry) => entry.trim());
  const urls = origins.map((origin) => {
    const url = new URL(origin);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.origin !== origin || (url.protocol !== 'https:' &&
      !(local && url.protocol === 'http:' && env.NODE_ENV !== 'production'))) {
      throw new Error('WEB_ORIGINS must contain exact HTTPS origins (loopback HTTP is allowed in development)');
    }
    return url;
  });
  const secure = urls[0].protocol === 'https:';
  if (urls.some((url) => (url.protocol === 'https:') !== secure)) {
    throw new Error('WEB_ORIGINS must use a single scheme');
  }
  return { origins, secure, cookieName: secure ? '__Host-kh_session' : 'kh_session' };
}

export type BrowserPolicy = ReturnType<typeof browserPolicy>;

export function authError(status: number, code: string, message: string) {
  return new HttpException({ code, message }, status);
}

export function requireOrigin(request: Request, policy: BrowserPolicy) {
  if (!policy.origins.includes(request.get('origin') ?? '')) {
    throw authError(403, 'ORIGIN_FORBIDDEN', 'Request origin is forbidden.');
  }
}

export function sessionCookie(policy: BrowserPolicy, token: string, maxAge: number) {
  return `${policy.cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${policy.secure ? '; Secure' : ''}`;
}

export function readSession(request: Request, policy: BrowserPolicy) {
  const prefix = `${policy.cookieName}=`;
  const matching = request.headers.cookie?.split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(prefix));
  if (matching?.length !== 1) return undefined;
  const token = matching[0].slice(prefix.length);
  return /^[\w-]{43}$/.test(token) ? token : undefined;
}

export function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function csrfToken(token: string) {
  return createHmac('sha256', token).update('knowledge-hub csrf v1').digest('base64url');
}

export function requireCsrf(request: Request, token: string) {
  const supplied = request.get(csrfHeader) ?? '';
  if (!/^[\w-]{43}$/.test(supplied) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(csrfToken(token)))) {
    throw authError(403, 'CSRF_INVALID', 'CSRF token is missing or invalid.');
  }
}
