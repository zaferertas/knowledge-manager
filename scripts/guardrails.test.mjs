import test from 'node:test';
import assert from 'node:assert/strict';
import { MILESTONES, scanContent, dangerousCommand, checkMilestoneOrder, checkFiles, validateMobileGate } from './guardrails.mjs';

test('detects probable secrets while allowing ordinary source', () => {
  assert.equal(scanContent('apps/api/config.ts', 'export const port = 3000;').length, 0);
  assert.match(scanContent('apps/api/config.ts', 'DATABASE_URL=postgres://admin' + ':not-for-commit@127.0.0.1:5432/db')[0], /database URL/);
});
test('rejects out-of-baseline dependency additions without banning docs that discuss them', () => {
  assert.match(scanContent('package.json', JSON.stringify({dependencies:{'bullmq':'1.0.0'}}))[0], /unapproved dependency/);
  assert.equal(scanContent('docs/ARCHITECTURE.md', 'Do not use Redis or BullMQ').length, 0);
});
test('denies irreversible tool commands without denying normal git operations', () => {
  assert.equal(dangerousCommand('git reset --hard HEAD'), 'git reset --hard');
  assert.equal(dangerousCommand('pnpm drizzle-kit push'), 'unversioned DB schema push');
  assert.equal(dangerousCommand('git status && git diff'), null);
});
test('guards roadmap milestone order', () => {
  const correct = MILESTONES.map((name, i) => `### Milestone ${i} — ${name}`).join('\n');
  assert.deepEqual(checkMilestoneOrder(correct), []);
  assert.notEqual(checkMilestoneOrder(correct.replace('Milestone 4', 'Milestone 6')).length, 0);
});
test('requires explicit signed-off web/backend release evidence before mobile code', () => {
  assert.match(validateMobileGate(['apps/mobile/shared/src/main/kotlin/App.kt'], null)[0], /requires/);
  assert.deepEqual(validateMobileGate(['apps/mobile/README.md'], null), []);
  const evidence = { status: 'approved', milestone: 8, approvedBy: 'reviewer', evidence: { ciRun: 'CI: passed', webCrudE2E: 'E2E: passed', apiSecurity: 'API: passed', openApiContract: 'spec: verified' } };
  assert.deepEqual(validateMobileGate(['apps/mobile/androidApp/build.gradle.kts'], JSON.stringify(evidence)), []);
});
test('shipped documents and hook sources pass static checks', () => {
  const result = checkFiles('all');
  assert.deepEqual(result.errors, []);
});
