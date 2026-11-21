/** Repository guardrails: no dependencies beyond Node.js 22+. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OMIT = new Set(['.git', '.gradle', '.idea', 'node_modules', 'dist', 'build', 'coverage', '.next', '.turbo', '.pnpm-store', 'out']);
const IGNORE_ROOT = new Set(['.DS_Store']);
const TEXT_EXT = new Set(['.md', '.mjs', '.cjs', '.js', '.jsx', '.ts', '.tsx', '.json', '.jsonc', '.yaml', '.yml', '.toml', '.sql', '.sh', '.kt', '.kts', '.swift', '.xml', '.properties', '.gradle']);
const BLOCKED_EXT = new Set(['.pem', '.p12', '.pfx', '.key', '.jks', '.keystore', '.gguf', '.safetensors', '.ckpt', '.onnx', '.pth', '.pt']);
const BLOCKED_PACKAGES = new Set(['prisma', '@prisma/client', 'bullmq', 'ioredis', 'redis', '@anthropic-ai/sdk', 'openai', '@pinecone-database/pinecone', 'langchain']);
const SECRET_MARKERS = [
  { name: 'private key material', re: /-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----/ },
  { name: 'AWS access key ID', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub access token', re: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/ },
  { name: 'live-looking API token', re: /\bsk-[A-Za-z0-9_-]{24,}\b/ },
  { name: 'database URL with embedded password', re: /\bpostgres(?:ql)?:\/\/[^\s:@/$]+:[^\s@/$]+@/i },
];
const MOBILE_GATE = 'docs/releases/web-mvp.json';
const MOBILE_GATE_EVIDENCE = ['ciRun', 'webCrudE2E', 'apiSecurity', 'openApiContract'];
export function validateMobileGate(files, rawGate) {
  const native = files.some((p) => p.startsWith('apps/mobile/') && p !== 'apps/mobile/README.md');
  if (!native) return [];
  if (!rawGate) return [`Native mobile code requires ${MOBILE_GATE}, approved only after Milestone 8 backend+web release tests`];
  try {
    const gate = JSON.parse(rawGate);
    const missing = MOBILE_GATE_EVIDENCE.filter((key) => typeof gate.evidence?.[key] !== 'string' || !gate.evidence[key].trim() || /^(todo|tbd|pending|n\/a)$/i.test(gate.evidence[key].trim()));
    if (gate.status !== 'approved' || gate.milestone !== 8 || typeof gate.approvedBy !== 'string' || !gate.approvedBy.trim() || missing.length) {
      return [`${MOBILE_GATE}: missing release approval or evidence fields: ${missing.join(', ') || 'status/milestone/approvedBy'}`];
    }
    return [];
  } catch { return [`${MOBILE_GATE}: invalid JSON`]; }
}
export const MILESTONES = [
  'Monorepo, hooks, and reproducible tooling',
  'Relational database foundation',
  'Authentication and authorization',
  'Notes and tags REST API (CRUD first)',
  'Web notes-and-tags vertical slice (usable product checkpoint)',
  'Durable note indexing (no search UI)',
  'Internal retrieval and one-shot RAG API',
  'Add Ask Your Notes to web',
  'Backend + web MVP release gate (mobile dependency)',
  'KMP shared foundation and API parity',
  'Android native app (Jetpack Compose)',
  'iOS native app (SwiftUI)',
  'Mobile parity, security and release gate',
];

function isWithinRoot(p) {
  const r = path.relative(ROOT, p);
  return r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r);
}
function normalize(p) { return p.split(path.sep).join('/'); }
function git(args, { allowFailure = false } = {}) {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { if (allowFailure) return null; throw e; }
}
function hasGit() { return git(['rev-parse', '--is-inside-work-tree'], { allowFailure: true })?.trim() === 'true'; }
function walk(dir, result = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (OMIT.has(item.name) || IGNORE_ROOT.has(item.name)) continue;
    const abs = path.join(dir, item.name);
    if (item.isDirectory()) walk(abs, result);
    else if (item.isFile()) result.push(normalize(path.relative(ROOT, abs)));
    // Do not follow symlinks that could escape the checkout.
  }
  return result;
}
function stagedFiles() {
  const raw = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']);
  return raw.split('\0').filter(Boolean);
}
function stagedText(p) {
  try { return execFileSync('git', ['show', ':' + p], { cwd: ROOT, encoding: 'utf8', maxBuffer: 12 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return null; }
}
function changesSince(base, staged) {
  if (!hasGit()) return [];
  const args = staged ? ['diff', '--cached', '--name-status', '-z'] :
    base === 'HEAD' ? ['diff', '--name-status', '-z', 'HEAD'] : ['diff', '--name-status', '-z', base, 'HEAD'];
  const raw = git(args, { allowFailure: true });
  if (raw === null) return [];
  const parts = raw.split('\0').filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length;) {
    const status = parts[i++];
    if (/^[RC]/.test(status)) { const oldName = parts[i++]; const newName = parts[i++]; out.push({ status: status[0], name: newName, oldName }); }
    else { out.push({ status: status[0], name: parts[i++] }); }
  }
  return out;
}
function existedAt(ref, p) {
  return git(['cat-file', '-e', `${ref}:${p}`], { allowFailure: true }) !== null;
}
function isMigration(p) {
  return /(?:^|\/)(?:migrations|drizzle)\/(?:.*\/)?[^/]+\.(?:sql|ts|js)$/i.test(p);
}
function isEnvFile(p) {
  const name = path.basename(p);
  return (name === '.env' || name.startsWith('.env.')) && name !== '.env.example';
}
export function scanContent(filename, body) {
  const issues = [];
  const ext = path.extname(filename).toLowerCase();
  if (!TEXT_EXT.has(ext) && !isEnvFile(filename)) return issues;
  for (const { name, re } of SECRET_MARKERS) {
    if (re.test(body)) issues.push(`${filename}: probable ${name}; remove from repository and rotate if real`);
  }
  if (path.basename(filename) === 'package.json') {
    try {
      const pkg = JSON.parse(body);
      for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        for (const dep of Object.keys(pkg[section] ?? {})) {
          if (BLOCKED_PACKAGES.has(dep) || dep.startsWith('@langchain/')) {
            issues.push(`${filename}: unapproved dependency ${dep} (${section}); request ADR/review before changing the approved stack`);
          }
        }
      }
    } catch { issues.push(`${filename}: invalid JSON`); }
  }
  return issues;
}
export function checkLinks(filename, body, existing) {
  const issues = [];
  const re = /\]\((\.\.?\/[^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of body.matchAll(re)) {
    const target = decodeURIComponent(match[1].split('#')[0].split('?')[0]);
    if (!target) continue;
    const abs = path.resolve(ROOT, path.dirname(filename), target);
    if (!isWithinRoot(abs)) { issues.push(`${filename}: link escapes repository: ${target}`); continue; }
    const rel = normalize(path.relative(ROOT, abs));
    if (!existing.has(rel) && !fs.existsSync(abs)) issues.push(`${filename}: broken relative link ${target}`);
  }
  return issues;
}
export function checkMilestoneOrder(body) {
  const matches = [...body.matchAll(/^### Milestone (\d+) — (.+)$/gm)];
  if (matches.length !== MILESTONES.length) return [`Implementation plan: expected ${MILESTONES.length} milestones; found ${matches.length}`];
  const errs = [];
  matches.forEach((m, i) => {
    if (Number(m[1]) !== i || m[2].trim() !== MILESTONES[i]) {
      errs.push(`Implementation plan: milestone ${i} changed or moved; update policy with human review if intentional`);
    }
  });
  return errs;
}
export function dangerousCommand(command) {
  // Conservative safety deny-list: the hook cannot understand arbitrary shell scripts.
  const patterns = [
    [/\bgit\s+reset\s+--hard\b/i, 'git reset --hard'],
    [/\bgit\s+clean\s+-[a-z]*f[a-z]*\b/i, 'git clean -f'],
    [/\bgit\s+push\b[^\n;|]*--force\b/i, 'git push --force'],
    [/\b(?:drizzle-kit\s+push|prisma\s+db\s+push)\b/i, 'unversioned DB schema push'],
    [/\brm\s+-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)[a-z]*\b/i, 'recursive forced deletion'],
    [/\bcurl\b[^\n;]*\|\s*(?:bash|sh)\b/i, 'pipe remote script into shell'],
  ];
  const found = patterns.find(([re]) => re.test(command));
  return found?.[1] ?? null;
}
export function checkFiles(mode = 'all') {
  if (!['staged', 'all', 'ci'].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
  if (mode === 'staged' && !hasGit()) throw new Error('staged check requires a Git working tree');
  const files = mode === 'staged' ? stagedFiles() : (hasGit() ? git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter((p) => p && fs.existsSync(path.join(ROOT, p)) && fs.lstatSync(path.join(ROOT, p)).isFile()) : walk(ROOT));
  const fileSet = new Set(mode === 'staged' ? walk(ROOT).concat(files) : files);
  const errors = [];
  const gatePath = path.join(ROOT, MOBILE_GATE);
  const gateContent = mode === 'staged' ? stagedText(MOBILE_GATE) : fs.existsSync(gatePath) ? fs.readFileSync(gatePath, 'utf8') : null;
  errors.push(...validateMobileGate(files, gateContent));
  for (const filename of files) {
    if (filename.includes('\0') || path.isAbsolute(filename) || filename.split('/').includes('..')) {
      errors.push(`Unsafe file path: ${filename}`); continue;
    }
    const extension = path.extname(filename).toLowerCase();
    if (isEnvFile(filename)) errors.push(`${filename}: real environment file must not be committed (use .env.example)`);
    if (BLOCKED_EXT.has(extension)) errors.push(`${filename}: private key, credential container, or model weight artifact forbidden`);
    const abs = path.join(ROOT, filename);
    if (!isWithinRoot(abs)) { errors.push(`Outside project: ${filename}`); continue; }
    const size = mode === 'staged' ? Buffer.byteLength(stagedText(filename) ?? '') : fs.statSync(abs).size;
    if (size > (filename === 'pnpm-lock.yaml' ? 10 : 2) * 1024 * 1024) errors.push(`${filename}: unusually large tracked file (${size} bytes)`);
    if (size > 12 * 1024 * 1024) continue;
    const content = mode === 'staged' ? stagedText(filename) : fs.readFileSync(abs, 'utf8');
    if (content === null) { errors.push(`${filename}: unable to read staged blob`); continue; }
    errors.push(...scanContent(filename, content));
    if (filename.endsWith('.md')) errors.push(...checkLinks(filename, content, fileSet));
    if (filename === 'docs/IMPLEMENTATION_PLAN.md') errors.push(...checkMilestoneOrder(content));
    if (filename === 'AGENTS.md' && Buffer.byteLength(content) > 3000) errors.push('AGENTS.md is too long (>3 KB); keep detailed policy in owning docs/hooks');
  }
  const baseline = mode === 'ci' ? process.env.GUARDRAILS_BASE_REF : 'HEAD';
  if (hasGit() && (mode !== 'ci' || baseline)) {
    for (const { status, name, oldName } of changesSince(baseline, mode === 'staged')) {
      const source = oldName ?? name;
      if (isMigration(source) && existedAt(baseline, source) && status !== 'A') {
        errors.push(`${source}: an existing migration was changed/deleted/renamed; create a new migration instead`);
      }
    }
  }
  // Non-bypassable logical invariants require tests, not static source scans.
  return { filesChecked: files.length, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2] ?? 'all';
    const { filesChecked, errors } = checkFiles(mode);
    if (errors.length) {
      console.error(`Guardrails FAILED (${mode}, ${filesChecked} files):\n- ${errors.join('\n- ')}`);
      process.exitCode = 1;
    } else console.log(`Guardrails PASS (${mode}): scanned ${filesChecked} files.`);
  } catch (e) { console.error(`Guardrails could not run: ${e.message}`); process.exitCode = 1; }
}
