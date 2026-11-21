# Personal Knowledge Hub — Product Requirements

**Status:** MVP scope agreed  
**Audience:** Developer, reviewers, and coding agents  
**Release sequence:** API auth + notes/tags CRUD → working web notes/tags CRUD → indexing/RAG + Ask web UI → backend + web MVP release → KMP/Android/iOS native clients

## 1. Purpose

Personal Knowledge Hub is a private, AI-powered note-taking application. A user writes plain-text notes, organizes them with tags, and asks questions in natural language. The application answers using the user's own notes and identifies the notes that support its answer.

**Core promise:** *Ask what you know, and see where the answer came from.*

The project is primarily a learning and public GitHub portfolio project. Its engineering goals are to demonstrate sound API development, data modeling, authentication, asynchronous processing, vector retrieval, local generative AI, frontend development, testing, and clear architectural reasoning. It is not intended to compete with feature-rich note-taking products in its first release.

## 2. Audience and release boundaries

- **Initial user:** The project author, with account registration and isolation suitable for multiple independent users.
- **MVP interfaces:** REST API and React web application.
- **Planned later:** Android (Jetpack Compose) and iOS (SwiftUI) applications sharing Kotlin Multiplatform networking and domain logic. Keep an `apps/mobile/` folder in the monorepo from the start, but mobile functionality is not part of the web MVP completion criteria. Native implementation **must not start until the backend + web MVP release gate passes**; `apps/mobile/README.md` is only an initial placeholder.
- **Knowledge source:** User-authored plain-text notes only. No files, PDFs, web pages, or external sources.
- **AI experience:** One question produces one answer (no conversational history).

## 3. Functional requirements (web MVP, with post-MVP mobile parity in FR-06)

### FR-01 — Accounts and sessions

1. Visitors can register with an email and password.
2. Registered users can sign in, sign out, and inspect their own session via a “current user” endpoint.
3. A user can access, change, or ask questions about **only their own** notes and tags.
4. Unauthenticated requests to protected resources are rejected.
5. Session expiration and logout cause subsequent requests to require authentication.

### FR-02 — Plain-text note management

1. Create a note with a required, nonblank title and an optional plain-text body.
2. List notes belonging to the signed-in user, ordered by last update (newest first).
3. Open a note to read its complete content and metadata.
4. Edit title and body; update the modification timestamp.
5. Delete a note, including its tag associations and derived embeddings.
6. Display when the note was created and last updated.
7. After indexing is implemented, show whether a note is pending, indexed, or failed indexing, using understandable labels. Before that, indicate **not yet indexed** honestly; note CRUD must already work without AI.
8. Use bounded inputs. Initial proposed limits: title 1–200 characters, body 0–5,000 characters; also validate the model's input-token limit. These values are implementation defaults, not an invitation to silently truncate content.

**Important:** The note is the source of truth. An unavailable AI service must never prevent the original note from being saved or edited.

### FR-03 — Tag management

1. Create, list, rename, and delete user-owned tags.
2. Attach zero or more tags to a note; remove existing associations.
3. Filter the note list by an assigned tag.
4. Do not allow two tags with the same normalized name for one user.
5. Disallow attaching another user's tag to a note.
6. Deleting a tag removes its associations but does not delete notes.

### FR-04 — Ask Your Notes (RAG)

1. The user enters a natural-language question in a simple **Ask Your Notes** screen.
2. The backend embeds the question and retrieves the most relevant **current, indexed, user-owned notes**.
3. A locally hosted generative model receives the question and selected notes as context.
4. The app displays a concise answer and clickable source references to the actual notes used as evidence.
5. If relevant evidence is absent or insufficient, display a clear **not enough information in your notes** response instead of confidently improvising.
6. If inference fails or times out, display a retryable error distinct from insufficient evidence.
7. An answer must not include fabricated note links or note identifiers. The backend validates returned source IDs against the retrieved, authorized context.
8. No answer or question history is persisted in the MVP.

**Internal retrieval is required for answering**, but there is **no separate search page**, keyword-search option, or chat conversation UI in the MVP.

### FR-05 — User experience

1. Provide screens for registration, login, note list, note creation/editing, tag management/filtering, and asking questions.
2. Clearly distinguish loading, empty, validation-error, network-error, AI-unavailable, and insufficient-evidence states.
3. Source references in an answer open the relevant note.
4. The note editor is **plain text**: no Markdown formatting, rich text, images, or attachments.
5. Basic responsive web layout should work on desktop and mobile-width browsers; this does not replace the future native clients. The note-and-tag web experience must work **before** RAG is integrated.

### FR-06 — Native mobile clients (post-web-MVP phase; not part of initial acceptance)

1. Ship separate **Android (Jetpack Compose)** and **iOS (SwiftUI)** applications after both the backend and web MVP are verified, sharing Kotlin Multiplatform domain/networking code.
2. Use the **same versioned `/api/v1` REST API** to register, sign in/out, browse/create/edit/delete notes, manage and filter tags, see indexing states, and ask one-shot questions with clickable citations.
3. Persist native session credentials only through secure platform-backed mechanisms (Android Keystore-based storage and iOS Keychain); handle expiry, revocation, logout, CSRF/origin behavior, and network failures without assuming browser `HttpOnly` cookie semantics.
4. Provide native loading/empty/error/accessibility behaviors comparable to web, but do not add offline sync, collaboration, rich text, chat history, or a new backend feature merely because mobile is being built.
5. Validate contract compatibility and security on both platforms, preserving web tests after any approved API/auth change. Native builds require Android and macOS/Xcode toolchains as appropriate.

## 4. Primary user flows

### Flow A — Register and create knowledge

1. User opens the web application and registers or signs in.
2. User creates a note with a title and body.
3. API persists the note; **once indexing is implemented**, it also queues embedding work in the same database transaction.
4. UI shows the saved note immediately, with an honest **not yet indexed** state before indexing is available, or **pending** once a job is enqueued.
5. After indexing is implemented, the worker generates and stores the embedding; UI later reports **ready**.
6. If indexing fails, the saved note remains accessible, with a visible failure/retry path.

### Flow B — Organize with tags

1. User creates tags such as `android`, `architecture`, and `learning`.
2. User assigns tags to notes.
3. User filters the note list to a chosen tag.
4. User removes or renames tags without losing note content.

### Flow C — Ask a grounded question

1. User navigates to **Ask Your Notes**.
2. User asks, “What did I learn about structured concurrency?”
3. Backend authenticates the user, creates a query embedding, and retrieves relevant **ready** note revisions.
4. Backend builds bounded context from those notes and asks the local model to answer from that evidence.
5. UI presents the answer with source-note links.
6. User opens a cited note to verify the supporting information.

### Flow D — Ask a question with no supporting notes

1. User asks about a topic absent from their notes.
2. Retrieval finds no sufficiently relevant evidence, or the evidence is insufficient to answer.
3. UI shows “I couldn't find enough information in your notes to answer that.”
4. It does **not** present a plausible unsupported answer as fact.

### Flow E — Edit or delete knowledge

1. User edits a note; its content revision increases. Once background indexing is implemented, a matching reindex job is queued atomically.
2. The previous embedding is not eligible as evidence for the revised note.
3. When new indexing completes, the updated note becomes eligible for answers.
4. User deletes the note; it is no longer available as an answer source.
5. A delayed worker job must not recreate an embedding for a deleted note.

## 5. Nonfunctional requirements

### Security and privacy

- Passwords are securely hashed; opaque session secrets are not stored in plaintext in the database.
- Browser auth uses secure, HttpOnly cookies in production with suitable SameSite/origin/CSRF defenses.
- All note, tag, retrieval, and source-reference operations are scoped to the authenticated user **in database queries**.
- Input validation, query parameter bounds, authentication rate limiting, and safe error messages are required.
- Notes and questions are sent only to the configured local/self-hosted AI runtime, not to paid third-party AI services, by default.
- No real user credentials or personal notes are committed to the repository, logs, examples, or test fixtures.

### Reliability and consistency

- Note writes remain available when embedding or generation services fail.
- Job scheduling is atomic with note changes. Jobs may run more than once; handlers must be idempotent.
- Out-of-order completion cannot publish stale embeddings.
- Retried, missing, failed, and deleted-note jobs are handled safely.
- An empty note collection and a collection with only unindexed notes both produce clear outcomes.

### Maintainability and developer experience

- Reproducible local setup with documented prerequisites, environment variables, migrations, and optional seed data.
- OpenAPI documentation for the REST API.
- Unit, integration, and API tests for important paths; deterministic fake models for most automated AI tests.
- Clearly named modules with minimal coupling; no unused infrastructure “for future scale.”
- CI verifies install/build/typecheck/lint/tests once those scripts exist.

### AI quality and performance

- Evaluate retrieval against a small synthetic dataset with expected source notes (approximately 20–30 representative questions).
- Evaluate whether generated answers are supported by retrieved notes, whether no-evidence questions abstain, and whether displayed citations point to real sources.
- Record latency separately for retrieval and generation. Hardware-dependent latency is documented, not promised as an unmeasured service-level guarantee.
- The retrieval threshold and context limit are measured/tuned; avoid hardcoded “perfect relevance” claims.

## 6. MVP acceptance scenarios

| ID | Scenario | Expected outcome |
|---|---|---|
| AC-01 | Register, log in, log out | Protected routes enforce session state |
| AC-02 | Create, edit, view, list, delete notes | Correct owner-scoped CRUD and timestamps |
| AC-03 | Create, assign, rename, delete tags | Associations remain consistent; note content survives tag deletion |
| AC-04 | Ask a question answerable from indexed notes | Answer plus valid links to supporting notes |
| AC-05 | Ask about an unsupported topic | Explicit insufficient-evidence response |
| AC-06 | Ollama unavailable during note creation | Note persists; embedding job retries/failure is visible |
| AC-07 | Edit note while earlier embedding job is running | Old revision never becomes current evidence |
| AC-08 | Delete note while job is pending | Note and embedding stay deleted |
| AC-09 | User B guesses User A's note/tag ID | Forbidden or not-found; no cross-user content leakage |
| AC-10 | New developer follows README | Can start dependencies, migrate, test, and run locally |

## 7. Post-MVP mobile acceptance scenarios

| ID | Scenario | Expected outcome |
|---|---|---|
| MAC-01 | Android user signs in, completes notes/tags CRUD, logs out | Same owner-scoped behavior as web; session stored securely |
| MAC-02 | iOS user signs in, completes notes/tags CRUD, logs out | Same owner-scoped behavior as web; session stored securely |
| MAC-03 | Android and iOS user ask a question and open source notes | Valid citations, correct loading/abstention/error handling |
| MAC-04 | Expired or revoked native session, app restart and network loss | No credentials leak; recoverable safe UI states |
| MAC-05 | API contract change for mobile | OpenAPI/KMP parity tests and backend/web regression suite pass |

## 8. Explicit exclusions

**Not in web MVP:** PDF/document upload, OCR, images, web clipping, Markdown/rich-text editing, nested folders, public note sharing, collaboration, offline sync, email/calendar integrations, semantic-search results page, keyword or hybrid search, multi-turn chat, persistent Q&A history, agents/tool calling, automatic summarization, title suggestions, transcription, Redis, microservices, Kubernetes, and paid-model dependencies.

**Future phase (only after the backend + web release gate):** KMP shared networking/domain, Android Jetpack Compose app, iOS SwiftUI app, and a distinct cross-platform release gate. All reuse `/api/v1`; no parallel product redesign.

## 9. Prioritization and scope changes

The product requirements in this document determine what to build. **Usable notes/tags CRUD comes before embedding, retrieval or RAG; mobile follows a fully completed backend + web MVP.** The implementation sequence lives in [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md); technical choices and their reasoning live in [`ARCHITECTURE.md`](./ARCHITECTURE.md). New features or changed user-visible behaviors should be agreed and reflected here before extending the system.
