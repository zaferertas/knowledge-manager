/** Runs the real workspace checks when the application scaffold exists. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './guardrails.mjs';

const mode = process.argv[2] || 'quick';
if (!['quick', 'ci'].includes(mode)) throw new Error(`Unknown verification mode: ${mode}`);
const pkgFile = path.join(ROOT, 'package.json');
if (!fs.existsSync(pkgFile)) {
  console.log('Docs-only bundle: application checks not applicable yet. Node guardrail unit tests and policy scans still run in CI.');
  process.exit(0);
}
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
if (!/^pnpm@\d+\.\d+\.\d+/.test(pkg.packageManager ?? '')) {
  console.error('package.json must pin packageManager to a tested pnpm version (e.g. pnpm@10.0.0).');
  process.exit(1);
}
const scripts = mode === 'ci' ? ['lint', 'typecheck', 'test', 'test:integration', 'build'] : ['lint', 'typecheck', 'test', 'build'];
const missing = scripts.filter((script) => !pkg.scripts?.[script]);
if (missing.length) {
  console.error(`Missing required root scripts: ${missing.join(', ')}. Wire tests in Milestone 0; do not silently skip them.`);
  process.exit(1);
}
for (const script of scripts) {
  if (/^(?:true|exit 0|echo(?:\s+.*)?)$/i.test(pkg.scripts[script].trim())) {
    console.error(`Root script '${script}' appears to be a no-op: implement a real verification command.`);
    process.exit(1);
  }
}
if (mode === 'ci' && (!fs.existsSync(path.join(ROOT, 'pnpm-lock.yaml')) || !fs.existsSync(path.join(ROOT, 'pnpm-workspace.yaml')))) {
  console.error('CI requires tracked pnpm-lock.yaml and pnpm-workspace.yaml after the app scaffold exists.');
  process.exit(1);
}
function run(args) {
  console.log(`> pnpm ${args.join(' ')}`);
  const result = spawnSync('pnpm', args, { cwd: ROOT, stdio: 'inherit', timeout: 180000 });
  if (result.error) { console.error(`Unable to invoke pnpm: ${result.error.message}`); process.exit(1); }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (mode === 'ci') run(['install', '--frozen-lockfile']);
for (const script of scripts) run(['run', script]);
console.log(`Workspace ${mode} verification PASS.`);
