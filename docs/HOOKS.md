# Automated guardrails and agent hooks

**The Milestone 0 workspace uses Node.js 24 and the pnpm version pinned in `package.json`.** The guardrail scripts themselves require Node.js 22+. They are not substitutes for authorization, CSRF, worker race or RAG-evaluation tests.

## Hook execution and responsibility

| Trigger | Registered hook | Automated outcome |
|---|---|---|
| Codex/Claude Code session start | `.codex/hooks.json` / `.claude/settings.json` → `agent-hook.mjs start` | Reminds agent of sources and delivery sequence; does **not** pretend the files were read |
| Before a supported agent Bash/edit tool | `agent-hook.mjs pre` | Rejects common destructive shell commands (`git reset --hard`, forced cleanup/push, unversioned schema push, remote script execution) and direct agent edits of `.env` in supported patch inputs |
| After a supported agent Bash/edit tool | `agent-hook.mjs post` | Runs local static scan; surfaces violations for correction (cannot undo the already executed tool call) |
| Agent turn stop | `agent-hook.mjs stop` | Checks policy and runs *quick* lint/typecheck/unit/build (if scaffolded). One-time continuation limit prevents endless Stop hook loops |
| Git pre-commit | `.githooks/pre-commit` | Checks **staged blobs**, not just the unstaged working tree, for prohibited files/dependencies/secrets, links, milestone order, oversized AGENTS and edits to existing migrations |
| Git pre-push | `.githooks/pre-push` | Scans complete tracked/unignored checkout, tests guardrail code, runs quick workspace checks |
| GitHub PR/push | `.github/workflows/guardrails.yml` | Repeats guardrail unit/static checks; compares existing migrations with PR base; after app scaffold exists, **requires** install + lint/typecheck/unit/real-PG integration/build scripts |

The static checker is `scripts/guardrails.mjs`; its unit tests are `scripts/guardrails.test.mjs`. It checks probable leaked secrets, accidentally tracked `.env`/credential material/model weights, unapproved baseline dependencies, large files, relative Markdown links and plan milestone ordering. Non-placeholder `apps/mobile/` files are blocked until a human-reviewed `docs/releases/web-mvp.json` records Milestone 8 approval and evidence for CI, web CRUD E2E, API security tests and the OpenAPI contract. The checker validates the evidence fields, **not their truth**; reviewers must confirm them. Existing SQL/Drizzle migration files cannot be modified or deleted in a staged change or PR; create a new migration instead. These are **preventive heuristics**, not proof of compliance. Approved stack exceptions require a documented architecture decision **and a reviewed update to the checker**.

### Mobile release approval record

After completing the Milestone 8 backend+web release checks, a human reviewer adds `docs/releases/web-mvp.json`. Required format (replace every sample value with **real verification evidence**):

```json
{
  "status": "approved",
  "milestone": 8,
  "approvedBy": "reviewer identity",
  "evidence": {
    "ciRun": "CI run ID or URL and result",
    "webCrudE2E": "E2E command, result and report link",
    "apiSecurity": "Auth/ownership/CSRF test command and result",
    "openApiContract": "OpenAPI contract check command and result"
  }
}
```

This record permits mobile file additions but is **not itself proof** that the referenced tests ran; enforce review of the evidence and protected-branch rules. Do not create it at scaffold time.

## Enable locally

1. Install **Node.js 22+**, Git, and (once the app exists) Corepack/pnpm and a working PostgreSQL+pgvector test service.
2. After committing/extracting these files into your Git repository, enable Git hooks once: `git config core.hooksPath .githooks`.
3. For **Codex**, work in a trusted project and review/enable the hooks shown by `/hooks`. The `.codex/hooks.json` file is auto-discovered in trusted local Codex projects; trust must be renewed after hook changes. For **Claude Code**, project `.claude/settings.json` adds lifecycle commands; review project settings/trust before using them. Host-specific agent hooks do **not** run automatically in every ChatGPT or remote environment.
4. Run these directly to validate setup:

   ```sh
   node scripts/guardrails.mjs all
   node --test scripts/*.test.mjs
   node scripts/verify.mjs quick
   # After staging changes in a Git repository:
   node scripts/guardrails.mjs staged
   ```

5. Protect `main` in GitHub, **require the `guardrails` status check** for merges, prevent direct pushes to protected branches, and require human review (especially for hook/workflow/policy/ADR changes). CI workflow files alone do not enable branch protection.

On macOS/Linux these shell-based Git and agent commands work with Git and Node on `PATH`. For native Windows terminals use WSL/Git Bash or adapt the shell commands; the bundled hook commands are not advertised as Windows-native PowerShell hooks. The mobile Xcode build also requires macOS; the generic Ubuntu CI job cannot validate SwiftUI/iOS.

## What is and is not enforced

- **Automatically detected:** common destructive agent commands, tracked sensitive file types, leaked-token patterns, additions of explicitly excluded packages, changed existing migrations, too-large `AGENTS.md`, broken Markdown relative links, milestone reordering, missing application verification scripts once app scaffolding exists, and mobile source added without a recorded web+backend release decision.
- **Verified by real tests during milestones:** authenticated user isolation at SQL level, CSRF/cookie behavior, atomic job enqueue, stale/retried/deleted worker races, source-ID allowlisting, prompt injection/abstention, UI/mobile auth/storage/contract behavior. The implementation plan names the needed tests and exit gates; add them as implementation is built.
- **Requires human judgment:** whether a change is truly in scope, architectural trade-offs, production security posture, empirical AI answer quality and milestone sign-off. No pre-tool text scan can validate all of these, nor can hooks force an agent to read a document.

**Limitations:** Local Git hooks can be bypassed with `--no-verify`; agents can disable or fail to trust project lifecycle hooks; an unsupported tool path may not invoke them; CI jobs are enforceable **only when branch rules make the check mandatory**. A malicious change can even alter hook logic, so use reviews and branch restrictions. For maximum practical coverage combine automatic checks, behavior-focused tests, branch protection, and explicit release evidence—never claim 100% guarantee from hooks alone.

## Timing and rollout notes

If your checkout is missing the Codex hook file, save the following as `.codex/hooks.json` from a shell with write access to the project. Open the project in Codex and review the registered hooks before enabling them.

```json
{
  "hooks": {
    "SessionStart": [{"hooks": [{"type": "command", "command": "node scripts/agent-hook.mjs start"}]}],
    "PreToolUse": [{"matcher": "Bash|exec_command|apply_patch", "hooks": [{"type": "command", "command": "node scripts/agent-hook.mjs pre"}]}],
    "PostToolUse": [{"matcher": "Bash|exec_command|apply_patch", "hooks": [{"type": "command", "command": "node scripts/agent-hook.mjs post"}]}],
    "Stop": [{"hooks": [{"type": "command", "command": "node scripts/agent-hook.mjs stop", "timeout": 200}]}]
  }
}
```

With the workspace scaffold present, CI fails if `pnpm-workspace.yaml`, `pnpm-lock.yaml`, or `lint`/`typecheck`/`test`/`test:integration`/`build` are missing. The `test:integration` script must exercise **real PostgreSQL/pgvector** using the workflow's local test database. The Milestone 0 smoke runs in a rolled-back transaction. Add application migrations and fixtures in Milestone 1. Agent stop and pre-push run the quicker checks without live AI. Full CI runs integration tests with a pgvector PostgreSQL service; a GPU or model download is never required for default CI.

After mobile development begins, add dedicated Android and macOS/iOS jobs with platform-specific signing/test setup; those checks become part of Milestone 12. The existing generic CI does not certify a native client.

Reference: [Codex lifecycle hooks](https://learn.chatgpt.com/docs/hooks) · [Claude Code hooks](https://code.claude.com/docs/en/hooks) · [Git hooks](https://git-scm.com/docs/githooks).
