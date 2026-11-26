import { Module } from '@nestjs/common';
import { databasePool } from '../common/database.js';
import { browserPolicy } from './browser.js';
import { AuthController } from './controller.js';
import { BROWSER_POLICY, CredentialGuard, SessionGuard } from './guards.js';
import { AUTH_DB, AuthService } from './service.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService, SessionGuard, CredentialGuard,
    { provide: BROWSER_POLICY, useFactory: () => browserPolicy(process.env) },
    { provide: AUTH_DB, useFactory: databasePool },
  ],
  exports: [SessionGuard, AuthService, BROWSER_POLICY, AUTH_DB],
})
export class AuthModule {}
