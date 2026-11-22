import { Module } from '@nestjs/common';
import pg from 'pg';
import { browserPolicy } from './browser.js';
import { AuthController } from './controller.js';
import { BROWSER_POLICY, CredentialGuard, SessionGuard } from './guards.js';
import { AUTH_DB, AuthService } from './service.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService, SessionGuard, CredentialGuard,
    { provide: BROWSER_POLICY, useFactory: () => browserPolicy(process.env) },
    {
      provide: AUTH_DB,
      useFactory: () => {
        const pool = new pg.Pool({
          connectionString: process.env.DATABASE_URL,
          database: process.env.PGDATABASE ?? 'knowledge_hub',
          user: process.env.PGUSER ?? 'knowledge_hub',
          port: Number(process.env.PGPORT ?? process.env.POSTGRES_PORT ?? 5432),
          connectionTimeoutMillis: 5000,
        });
        pool.on('error', () => console.error('Idle PostgreSQL connection failed.'));
        return pool;
      },
    },
  ],
  exports: [SessionGuard, AuthService, BROWSER_POLICY, AUTH_DB],
})
export class AuthModule {}
