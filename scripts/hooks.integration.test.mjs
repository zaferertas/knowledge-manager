/** Real Git integration: ensures hooks reject bad staged changes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './guardrails.mjs';

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return { code: result.status, output: (result.stdout ?? '') + (result.stderr ?? '') };
}
function mustGit(root, ...args) {
  const out = git(root, ...args);
  assert.equal(out.code, 0, `${args.join(' ')}: ${out.output}`);
}

test('real pre-commit blocks private env, premature mobile, and rewrite of migrations', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkh-git-hooks-'));
  try {
    for (const item of ['AGENTS.md', 'README.md', '.gitignore', 'docs', 'scripts', '.githooks']) {
      fs.cpSync(path.join(ROOT, item), path.join(temp, item), { recursive: true });
    }
    mustGit(temp, 'init', '-q');
    mustGit(temp, 'config', 'user.name', 'Hook Test');
    mustGit(temp, 'config', 'user.email', 'test@example.com');
    mustGit(temp, 'config', 'core.hooksPath', '.githooks');
    mustGit(temp, 'add', '-A');
    mustGit(temp, 'commit', '-qm', 'clean baseline');

    fs.writeFileSync(path.join(temp, '.env'), 'LOCAL_CONFIG=synthetic');
    mustGit(temp, 'add', '-f', '.env');
    let result = git(temp, 'commit', '-qm', 'unsafe env');
    assert.notEqual(result.code, 0);
    assert.match(result.output, /real environment file/);
    mustGit(temp, 'reset', '-q', 'HEAD', '--', '.env');
    fs.unlinkSync(path.join(temp, '.env'));

    const mobile = path.join(temp, 'apps/mobile/shared/src/Models.kt');
    fs.mkdirSync(path.dirname(mobile), { recursive: true });
    fs.writeFileSync(mobile, 'class Models');
    mustGit(temp, 'add', '-A');
    result = git(temp, 'commit', '-qm', 'early mobile');
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Native mobile code requires/);
    mustGit(temp, 'reset', '-q', 'HEAD', '--', 'apps/mobile/shared/src/Models.kt');
    fs.unlinkSync(mobile);

    const migration = path.join(temp, 'packages/database/migrations/0001_init.sql');
    fs.mkdirSync(path.dirname(migration), { recursive: true });
    fs.writeFileSync(migration, 'CREATE TABLE t (id integer);\n');
    mustGit(temp, 'add', '-A');
    mustGit(temp, 'commit', '-qm', 'new migration allowed');
    fs.writeFileSync(migration, 'DROP TABLE t;\n');
    mustGit(temp, 'add', '-A');
    result = git(temp, 'commit', '-qm', 'alter old migration');
    assert.notEqual(result.code, 0);
    assert.match(result.output, /existing migration was changed/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
