# ADR-009 — Native session transport

Status: Proposed for Milestone 9. The web MVP ships the existing v1 cookie-backed protocol.

Test Ktor with an HTTPS, host-scoped cookie jar that stores the opaque session credential using Android Keystore-backed encrypted storage and iOS Keychain. Keep the CSRF token in memory and obtain it from registration, login, or `GET /api/v1/auth/me` after restart. Send the documented token on authenticated writes and supply an exact deployment-configured origin for routes that require it. Verify behavior on both targets, including whether the network engine permits the explicit Origin header. Native cookie handling must enforce HTTPS and host scope independently of browser flags.

On session expiry or revocation, clear local credentials and return to sign-in. On logout, revoke the server session before reporting successful logout. A network failure leaves revocation unconfirmed and should allow a retry. Validate app restart, logout, revocation, origin and CSRF rejection, and secure storage on both targets. The server continues to enforce ownership through the authenticated principal.

The decision depends on that parity test. If either platform cannot safely use the existing cookie protocol, propose a separate authenticated transport in a reviewed ADR with compatibility and revocation behavior, and rerun API and web regressions before changing v1.
