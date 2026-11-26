# Web MVP release review

## Reproduce the checks

From a fresh checkout, follow [local setup](../../README.md#local-setup) with a disposable PostgreSQL 17 and pgvector instance. Standard CI uses deterministic AI responses.

```sh
node scripts/guardrails.mjs ci
node scripts/verify.mjs ci
pnpm --filter @knowledge-hub/web exec playwright install chromium
pnpm test:e2e
```

The workspace verifier installs with the frozen lockfile, lints, typechecks, runs unit tests, exercises PostgreSQL and HTTP integration, and builds the API and web app. The HTTP suite covers session expiry and revocation, cookies, CORS and CSRF, migrations, cross-account denial, queue atomicity and races, and Ask source authorization. It also checks database readiness before and after migration and compares the served schema under the production cookie policy to the [v1 snapshot](../api/v1.openapi.json). The browser suite covers notes and tags CRUD, indexing and retry, Ask, model unavailability, and citation navigation.

## Local evidence

- `node scripts/verify.mjs ci` passed from a clean source copy with a fresh workspace install, PostgreSQL 17 and pgvector. The integration tests and browser harness created disposable databases and applied the checked-in migrations. The workspace suite included the request-log redaction check and the pending-release Git hook test.
- `pnpm test:e2e` passed both tests using the installed Opera executable on macOS 12. The first run lost the Opera process before opening the CRUD test page. The CRUD test passed in a fresh process and both tests passed together on rerun. The Playwright Chromium installer reported that it does not support this host.

## Security and distribution review

- Deploy behind same-origin HTTPS and keep the API, PostgreSQL and Ollama on private interfaces. The session credential is hashed at rest. Writes require the configured origin and, for an existing session, the session-bound CSRF token. Direct-IP credential limits are per process, so clients behind one proxy share its quota. A public deployment needs its own edge limits and infrastructure log review.
- Review application and proxy logging together. API and worker logs omit credentials and content. Ollama receives privately authored notes and questions by design, so operators must control access to that service and its logs.
- `pnpm -r licenses list --prod --json` reported declared dependency licenses of MIT, Apache-2.0, Python-2.0, PSF-2.0, ISC, BSD-3-Clause and 0BSD in the local install. An actual redistributable bundle needs its notice and artifact review. The repository has no application license grant.
- `pnpm audit --prod --json` completed with zero reported advisories at review time.
- `nomic-embed-text` uses Apache-2.0. The configured `qwen2.5:3b` variant uses the Qwen Research License, which limits the permitted use. The local research setup downloads the artifacts separately. Review the exact runtime artifact and terms before any wider use or distribution. [Nomic model card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5/tree/main) · [Ollama model package](https://ollama.com/library/qwen2.5:3b) · [Qwen Research License](https://huggingface.co/Qwen/Qwen2.5-3B-Instruct/blob/14d7620ba47cf51be0b176e14e27e38a34d4ff88/LICENSE)

## Release decision

Review the [live-model evidence and limitations](../evaluation/web-mvp.md) and the [native session proposal](../adr/009-native-session-transport.md). The reviewer records their decision in [web-mvp.json](web-mvp.json) after reviewing a hosted Guardrails run for the release candidate. The [gate instructions](../HOOKS.md#mobile-release-approval-record) define the required fields. Milestones 9–12 remain deferred until the recorded decision is approved.
