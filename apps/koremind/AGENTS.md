# Working on KoreMind

## Authentication is Kore ID only

Kore ID (OpenID Connect) is the **only** way a person signs in, on web, Android and the backend. The backend is the confidential OIDC client; clients only trade a one-time PKCE ticket.

Do not add or restore:

- email + password login or first-account registration/setup;
- password change/reset or password fields for creating accounts;
- `/auth/login`, `/auth/register` or a local password session route;
- a `KOREMIND_PASSWORD_LOGIN`-style switch, or any “password login” flag in config, deploy files or docs.

Keep and protect:

- `/auth/oidc/start`, `/auth/callback`, `/auth/oidc/exchange`, OIDC sessions, tickets/PKCE, `/auth/backchannel-logout` and RP-initiated logout;
- owner rules (`KOREMIND_OIDC_OWNER_EMAIL`, otherwise the first account) and auto-provisioning;
- linking by verified email for accounts that predate Kore ID-only sign-in;
- non-human credentials: opaque session/API tokens used by agents, Kore ID access tokens as API bearers, and QR pairing.

QR pairing is **Kore ID-backed**. A pairing code can only be minted from an already Kore ID-authenticated web session; redeeming it creates a session for that same account and never creates an account. It inherits the Kore ID `sid`, so Kore ID back-channel logout signs the phone out too. Do not turn pairing into a password/registration path.

The `users.password_hash` column is legacy. It stays in the schema so existing databases need no rewrite, but it must never be read or checked. New rows use an empty placeholder to satisfy `NOT NULL`.

## Checks

```bash
bun test backend shared web scripts
bunx --bun tsc --noEmit -p web
cd android && ./gradlew :app:testDebugUnitTest
```

## Keeping clients in step

Web (`web/`) and Android (`android/`) are kept 1:1: same features, wording and pure helpers, each with tests. When you change one, change the other and update both string files.
