import { randomBytes } from 'node:crypto';
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import pg from 'pg';
import { authError, sessionLifetimeSeconds, tokenHash } from './browser.js';
import { hashPassword, verifyPassword } from './password.js';

export const AUTH_DB = Symbol('AUTH_DB');

export interface Principal {
  id: string;
  email: string;
}

@Injectable()
export class AuthService implements OnApplicationShutdown {
  constructor(@Inject(AUTH_DB) private readonly db: pg.Pool) {}

  onApplicationShutdown() {
    return this.db.end();
  }

  async register(email: string, password: string) {
    const passwordHash = await hashPassword(password);
    const token = randomBytes(32).toString('base64url');
    const { rows: [user] } = await this.db.query<Principal>(`
      WITH account AS (
        INSERT INTO users (email, password_hash) VALUES ($1, $2)
        ON CONFLICT (email) DO NOTHING
        RETURNING id, email
      ), session AS (
        INSERT INTO sessions (user_id, token_hash, expires_at)
        SELECT id, $3, now() + $4 * interval '1 second' FROM account
      )
      SELECT id, email FROM account
    `, [email, passwordHash, tokenHash(token), sessionLifetimeSeconds]);
    if (!user) throw authError(409, 'EMAIL_IN_USE', 'An account already exists for this email.');
    return { user, token };
  }

  async login(email: string, password: string) {
    const { rows: [account] } = await this.db.query<Principal & { password_hash: string }>(
      'SELECT id, email, password_hash FROM users WHERE email = $1', [email],
    );
    const valid = await verifyPassword(password, account?.password_hash);
    if (!account || !valid) throw authError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');

    const token = randomBytes(32).toString('base64url');
    await this.db.query(`
      INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES ($1, $2, now() + $3 * interval '1 second')
    `, [account.id, tokenHash(token), sessionLifetimeSeconds]);
    return { user: { id: account.id, email: account.email }, token };
  }

  async currentUser(token: string) {
    const { rows: [user] } = await this.db.query<Principal>(`
      SELECT users.id, users.email
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = $1 AND sessions.revoked_at IS NULL AND sessions.expires_at > now()
    `, [tokenHash(token)]);
    return user;
  }

  async logout(userId: string, token: string) {
    await this.db.query(`
      UPDATE sessions SET revoked_at = now()
      WHERE user_id = $1 AND token_hash = $2 AND revoked_at IS NULL
    `, [userId, tokenHash(token)]);
  }
}
