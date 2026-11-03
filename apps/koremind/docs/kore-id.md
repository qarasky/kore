# Kore ID (single sign-on)

KoreMind can sign people in with **Kore ID**, the OpenID Connect provider shared by Kore, KoreMind, KoreCalendar and Flatline. It is optional. With `KOREMIND_OIDC_ISSUER` unset, nothing changes: email and password, QR pairing, and the opaque session tokens work exactly as before.

## How it works

```
 web / Android            KoreMind backend                    Kore ID
      |  POST /auth/oidc/start {challenge, returnTo}  |                    |
      |---------------------------------------------->| state, nonce,      |
      |<-------------------------- {url} -------------| PKCE verifier      |
      |  open url ------------------------------------------------------>  | login (once for all apps)
      |<------------------------- 302 /auth/callback?code&state ---------- |
      |  GET /auth/callback --------->| code + client secret + verifier --->|
      |                               |<-- id_token (EdDSA) ----------------|
      |                               | verify iss, aud, exp, nonce, JWKS
      |<-- 302 <web>#sso_ticket=…  or  koremind://sso?ticket=…
      |  POST /auth/oidc/exchange {ticket, verifier}   |
      |<-------------- {token, user} (a normal KoreMind session)
```

- The **backend** is the confidential OIDC client (authorization code, PKCE S256, `state`, `nonce`, client secret). Endpoints and signing keys come from `<issuer>/.well-known/openid-configuration` and its JWKS; nothing is hard-coded.
- The browser or phone only receives a **one-time ticket** (60 s, single use). It can redeem it only with the PKCE verifier it generated itself and kept (web: `sessionStorage`; Android: app preferences). A ticket leaking through a URL, a log or another app's custom-scheme handler is useless.
- The result is the **same session as a password login**: an opaque token row in `tokens`, stored in the same place by the web and Android apps. Nothing downstream changed (chats, uploads, pairing, agents).
- Users are keyed on the Kore ID **`sub`** (`users.oidc_sub`, unique). Email and name are not synced afterwards, so a changed Kore ID email does not break the link.
- **Logout** ends the KoreMind session and, on the web, also the Kore ID session (RP-initiated logout with `id_token_hint`, back to `<web>/login`). Android ends the KoreMind session only for now.
- **Kore ID access tokens as API bearers**: `Authorization: Bearer <jwt>` is accepted when its signature, issuer, audience (`koremind`), and expiry check out, it carries a `scope` (so ID tokens do not work) and its `sub` is linked to a local account. It never creates accounts. Existing opaque tokens are tried first; a JWT has dots, ours do not.

## Set it up

1. In Kore ID's `clients.json` register the client (the entry for `koremind` already exists; set real URIs):

   ```json
   {
     "id": "koremind",
     "name": "KoreMind",
     "secretHash": "<sha256 hex of the secret>",
     "redirectUris": ["https://api.koremind.example.com/auth/callback"],
     "postLogoutRedirectUris": ["https://koremind.example.com/login"]
   }
   ```

   The redirect URI is the **backend's** `/auth/callback` (the backend does the exchange), i.e. `KOREMIND_PUBLIC_URL` + `/auth/callback`. The post-logout URI is the web UI's `/login`.

2. Set on the backend (see [deployment-docker.md](deployment-docker.md), `deploy/koremind.env.example`):

   | Setting | Default | Meaning |
   |---|---|---|
   | `KOREMIND_OIDC_ISSUER` | unset (off) | Kore ID base URL. Turns the feature on. |
   | `KOREMIND_OIDC_CLIENT_ID` | `koremind` | |
   | `KOREMIND_OIDC_CLIENT_SECRET` / `_FILE` | empty | Client secret (or a file holding it, for Docker/systemd secrets). Empty = public client. |
   | `KOREMIND_OIDC_REDIRECT_URI` | `$KOREMIND_PUBLIC_URL/auth/callback` | Must equal the registered URI. |
   | `KOREMIND_OIDC_SCOPES` | `openid profile email` | |
   | `KOREMIND_WEB_ORIGINS` | loopback only | Comma-separated origins the web UI may be served from (open-redirect guard), e.g. `https://koremind.example.com`. **Set this** in any real deployment. |
   | `KOREMIND_OIDC_ALLOWED_EMAILS` | empty | Emails or `@domains` that may get an account. When set, only they can (also the first/owner). |
   | `KOREMIND_OIDC_AUTO_PROVISION` | off | `1` = anyone with a Kore ID gets an account. See the warning below. |
   | `KOREMIND_OIDC_TRUST_EMAIL_LINK` | off | `1` = link a Kore ID to the existing local account with the same email. See the warning below. |
   | `KOREMIND_PASSWORD_LOGIN` | on | `0` = email + password sign-in and registration off. Ignored (stays on) unless Kore ID is configured, so you cannot lock yourself out by accident. |

3. Restart. `GET /health` shows `"sso": true`; the web and Android login screens show **Continue with Kore ID**.

## Who gets an account

KoreMind gives every account access to the owner's model providers and keys, and Kore ID has open sign-up. So a Kore ID login does **not** create an account by default, except:

- the very first user on an empty KoreMind (they become the owner, as with the password setup), and
- anyone matched by `KOREMIND_OIDC_ALLOWED_EMAILS`, or anyone at all if `KOREMIND_OIDC_AUTO_PROVISION=1`.

Anyone else is shown "this KoreMind does not accept new accounts". Accounts made through Kore ID have no password.

## Existing users (migration)

Nothing is rewritten and no data is orphaned: chats, notes, uploads and settings hang off the local user id, which never changes. A Kore ID is attached to a local user by adding its `sub` to that row. Kore ID **does not verify email addresses** and sends no `email_verified` claim, so "same email" proves nothing: anybody could register `owner@…` on Kore ID. Hence the default is not to link by email. Choose one:

1. **Link while signed in (safe, recommended).** Sign in with the old password, open **Settings → Account → Link Kore ID**, sign in at Kore ID. From then on either works. Then, if you want, set `KOREMIND_PASSWORD_LOGIN=0`.
2. **`KOREMIND_OIDC_TRUST_EMAIL_LINK=1`.** The first Kore ID sign-in with a matching email links to the old account automatically. Only use it while Kore ID sign-up is closed or email-verified, and turn it off afterwards.
3. Manual: `sqlite3 koremind.sqlite "update users set oidc_sub='<sub>' where email='…'"`.

If someone signs in with Kore ID before linking and their email already exists locally, they get "an account with this email already exists" instead of a duplicate.

## Android

Done: the login screen shows **Continue with Kore ID** (and hides the password form when the server turns it off); the app asks the backend to start, opens the system browser, receives `koremind://sso?ticket=…` (intent filter on `MainActivity`), and trades the ticket with its own PKCE verifier. Unit tests cover the PKCE helper and link parsing.

Not done: Android does not end the Kore ID browser session on sign-out; it cannot link a Kore ID from Settings; the custom scheme `koremind://` is not a verified App Link. None of this needs a separate Kore ID client, because the backend is the OIDC client. **Only if the app should talk to Kore ID directly** (no backend in between) it would need a public client such as:

```json
{ "id": "koremind-android", "name": "KoreMind (Android)", "redirectUris": ["dev.qarasky.koremind:/oauth2redirect"], "postLogoutRedirectUris": ["dev.qarasky.koremind:/signed-out"] }
```

with no `secretHash` (PKCE only).

## Limits and notes

- Kore ID access tokens live 10 minutes and there is no introspection endpoint, so disabling a user in Kore ID takes effect for API bearers within that time. KoreMind sessions made from a Kore ID login last 30 days like any other and are not tied to the Kore ID session (signing out of Kore ID elsewhere does not end them).
- Discovery is cached for an hour (last good copy kept if Kore ID is briefly unreachable); the JWKS is cached and refreshed on unknown `kid`.
- Rate limits: 30 sign-in starts and 20 ticket exchanges per address per 15 minutes.
