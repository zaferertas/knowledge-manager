/** Tool/turn lifecycle adapter compatible with Codex and Claude Code hooks. */
import { checkFiles, dangerousCommand } from './guardrails.mjs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './guardrails.mjs';

function deny(reason) { console.error(`[pkh hook] ${reason}`); process.exit(2); }
function checkOrDeny() {
  const { errors } = checkFiles('all');
  if (errors.length) deny(`Fix repository guardrail violations:\n- ${errors.slice(0, 15).join('\n- ')}`);
}

const event = process.argv[2];
let payload = {};
try {
  const input = fs.readFileSync(0, 'utf8').trim();
  if (input) payload = JSON.parse(input);
} catch (e) { deny(`Hook input unavailable/invalid: ${e.message}`); }

if (event === 'start') {
  console.log('Project: read AGENTS.md, docs/PRODUCT.md, docs/ARCHITECTURE.md, docs/IMPLEMENTATION_PLAN.md. Build working notes/tag CRUD on web before AI; mobile after backend+web release. Checks run automatically at tool/edit/stop + git/CI boundaries.');
} else if (event === 'pre') {
  const input = payload.tool_input ?? {};
  const command = typeof input.command === 'string' ? input.command : '';
  const flagged = dangerousCommand(command);
  if (flagged) deny(`Blocked dangerous action (${flagged}); prefer reversible, reviewed changes`);
  // Inspect supported edit-tool paths before execution. Arbitrary shell scripts
  // are not parseable reliably; post-tool and CI checks provide backstops.
  const targets = [input.file_path, input.path].filter((value) => typeof value === 'string');
  for (const match of command.matchAll(/^\*\* (?:Update|Delete|Add) File: (.+)$/gm)) targets.push(match[1].trim());
  for (const target of targets) {
    const filename = path.resolve(ROOT, target);
    const relative = path.relative(ROOT, filename).split(path.sep).join('/');
    if (relative.startsWith('../') || path.isAbsolute(relative)) continue;
    if (path.basename(relative) === '.env' || /^\.env\.(?!example$)/.test(path.basename(relative))) {
      deny(`Private .env file edits are not allowed through agent tools: ${relative}`);
    }
    if (/(?:^|\/)(?:migrations|drizzle)\/(?:.*\/)?[^/]+\.(?:sql|ts|js)$/i.test(relative)) {
      const exists = spawnSync('git', ['cat-file', '-e', `HEAD:${relative}`], { cwd: ROOT, stdio: 'ignore' }).status === 0;
      const isNew = command.includes(`*** Add File: ${target}`);
      if (exists && !isNew) deny(`Existing migration ${relative} must not be overwritten. Create a new migration.`);
    }
  }
} else if (event === 'post') {
  checkOrDeny();
} else if (event === 'stop') {
  // Avoid endless Stop continuations. Required CI remains the final merge gate.
  if (!payload.stop_hook_active) {
    checkOrDeny();
    const result = spawnSync(process.execPath, ['scripts/verify.mjs', 'quick'], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
    if (result.status !== 0) deny(`Quick verification failed:\n${(result.stdout ?? '') + (result.stderr ?? '')}`);
  }
} else deny(`Unknown hook event: ${event}`);
