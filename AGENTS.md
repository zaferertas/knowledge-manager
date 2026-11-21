# Agent operating guide

Applies to Codex and other coding agents working in this repository. Keep this file short; the linked documents are the sources of truth.

## Start here

1. Read [Product](docs/PRODUCT.md) for **what** is in scope.
2. Read [Architecture](docs/ARCHITECTURE.md) for **how** it is designed.
3. Read [Implementation plan](docs/IMPLEMENTATION_PLAN.md) for **when** to build it. Identify the current milestone and implement one coherent step only.
4. Read the relevant source, scripts, and tests before editing. Do not assume a command or tool exists.

## Working agreement

- Before changing code, briefly identify the step, affected files, test plan, and any contract/schema impact.
- Build **notes/tags API and usable web CRUD before semantic retrieval/RAG**; start native Android/iOS work only after the backend + web MVP release gate. Do not implement unapproved future features.
- Preserve the product and architecture contracts. If a request changes them, update the owning document and explain the decision; do not silently change scope or applied migrations.
- Run applicable automatic checks. **Never say a check passed unless it ran.** Use synthetic fixtures; never add credentials, private notes, or model weights.
- Finish with: **Implemented / Verified (commands and results) / Not verified or risks / Next milestone step**. Mark checklist items complete only with verifiable evidence.

## Automated guardrails

- Agent lifecycle hooks: `.codex/hooks.json` and `.claude/settings.json` (subject to agent trust/settings).
- Git hooks: `.githooks/`; install once with `git config core.hooksPath .githooks`.
- CI: `.github/workflows/guardrails.yml`; set the `guardrails` check as required in branch protection.
- Hook implementation, coverage, limitations, and manual checks: [Guardrail automation](docs/HOOKS.md).

Hooks do not replace domain/security tests, code review, or required CI. Never bypass a failed check to make a milestone appear complete.
