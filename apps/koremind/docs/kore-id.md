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
      |                               | verify iss, aud, azp, exp, nonce, typ, JWKS; keep sid
      |<-- 302 <web>#sso_ticket=…  or  koremind://sso?ticket=…
      |  POST /auth/oidc/exchange {ticket, verifier}   |
      |<-------------- {token, user} (a normal KoreMind session)
```

- The **backend** is the confidential OIDC client (authorization code, PKCE S256, `state`, `nonce`, client secret). Endpoints and signing keys come from `<issuer>/.well-known/openid-configuration` and its JWKS; nothing is hard-coded.
- The browser or phone only receives a **one-time ticket** (60 s, single use). It can redeem it only with the PKCE verifier it generated itself and kept (web: `sessionStorage`; Android: app preferences). A ticket leaking through a URL, a log or another app's custom-scheme handler is useless.
- The result is the **same session as a password login**: an opaque token row in `tokens`, stored in the same place by the web and Android apps. Nothing downstream changed (chats, uploads, pairing, agents).
- Users are keyed on the Kore ID **`sub`** (`users.oidc_sub`, unique). Email and name are not synced afterwards, so a changed Kore ID email does not break the link.
- Each KoreMind session made from a Kore ID sign-in stores the Kore ID **`sid`** (the Kore ID browser session it came from).
- **Logout from KoreMind** ends the KoreMind session and also the Kore ID session (RP-initiated logout with `id_token_hint`): the web goes back to `<web>/login`; Android opens the URL in the browser, where Kore ID shows its "signed out" page.
- **Logout from Kore ID** (sign-out there, an admin disabling the user, "sign out everywhere", a password reset) reaches KoreMind by **back-channel logout**: Kore ID POSTs a logout token to `/auth/backchannel-logout` and KoreMind ends every session with that `sid` (or, if the token has no `sid`, every session of the account linked to that `sub`). See below.
- **Kore ID access tokens as API bearers**: `Authorization: Bearer <jwt>` is accepted when the JWT header says **`typ: at+jwt`** (RFC 9068; ID and logout tokens are refused), its signature, issuer, audience (`koremind`) and expiry check out, `client_id` (if present) is `koremind`, and its `sub` is linked to a local account. It never creates accounts. Existing opaque tokens are tried first; a JWT has dots, ours do not.

## Set it up

1. In Kore ID's `clients.json` register the client (the entry for `koremind` already exists; set real URIs):

   ```json
   {
     "id": "koremind",
     "name": "KoreMind",
     "app": "koremind",
     "secretHash": "<sha256 hex of the secret>",
     "redirectUris": ["https://api.koremind.example.com/auth/callback"],
     "postLogoutRedirectUris": ["https://koremind.example.com/login"],
     "backchannelLogoutUri": "https://api.koremind.example.com/auth/backchannel-logout",
     "homeUrl": "https://koremind.example.com/"
   }
   ```

   - `redirectUris`: the **backend's** `/auth/callback` (the backend does the exchange), i.e. `KOREMIND_PUBLIC_URL` + `/auth/callback`.
   - `backchannelLogoutUri`: the **backend's** `/auth/backchannel-logout`, i.e. `KOREMIND_PUBLIC_URL` + `/auth/backchannel-logout`. Kore ID must be able to reach it (server to server).
   - `postLogoutRedirectUris`: the web UI's `/login`.

   The backend prints the exact redirect and back-channel URIs on start. In Kore ID's admin, give the people who should use KoreMind access to the **KoreMind** app (admins always have it).

2. Set on the backend (see [deployment-docker.md](deployment-docker.md), `deploy/koremind.env.example`):

   | Setting | Default | Meaning |
   |---|---|---|
   | `KOREMIND_OIDC_ISSUER` | unset (off) | Kore ID base URL. Turns the feature on. |
   | `KOREMIND_OIDC_CLIENT_ID` | `koremind` | |
   | `KOREMIND_OIDC_CLIENT_SECRET` / `_FILE` | empty | Client secret (or a file holding it, for Docker/systemd secrets). Empty = public client. |
   | `KOREMIND_OIDC_REDIRECT_URI` | `$KOREMIND_PUBLIC_URL/auth/callback` | Must equal the registered URI. |
   | `KOREMIND_OIDC_SCOPES` | `openid profile email` | |
   | `KOREMIND_WEB_ORIGINS` | loopback only | Comma-separated origins the web UI may be served from (open-redirect guard), e.g. `https://koremind.example.com`. **Set this** in any real deployment. |
   | `KOREMIND_OIDC_AUTO_PROVISION` | **on** | Anyone Kore ID lets into KoreMind gets an account on first sign-in. `0` = only the first user (owner) and the allow-list. |
   | `KOREMIND_OIDC_ALLOWED_EMAILS` | empty | Optional extra filter: emails or `@domains` that may get an account (also the first/owner). Kore ID's app access already decides who gets this far. |
   | `KOREMIND_OIDC_OWNER_EMAIL` | empty | Pins the owner of an **empty** KoreMind to this email (see below). Recommended for a fresh install. |
   | `KOREMIND_OIDC_EMAIL_LINK` | **on** | Link a first Kore ID sign-in to the existing local account with the same email **when the token says `email_verified: true`**. `0` = link by hand only. Old name `KOREMIND_OIDC_TRUST_EMAIL_LINK` is still read (the new name wins); unlike before, it never links an unverified email. |
   | `KOREMIND_PASSWORD_LOGIN` | on | `0` = email + password sign-in and registration off. Ignored (stays on) unless Kore ID is configured, so you cannot lock yourself out by accident. |

3. Restart. `GET /health` shows `"sso": true`; the web and Android login screens show **Continue with Kore ID**.

## Who gets an account

Kore ID accounts are created by a Kore ID admin (no self sign-up), and Kore ID only lets a user into KoreMind when the admin gave them access to the KoreMind app. So by default **anyone who gets through Kore ID gets a KoreMind account** on first sign-in (as a normal user). `KOREMIND_OIDC_ALLOWED_EMAILS` narrows that further; `KOREMIND_OIDC_AUTO_PROVISION=0` restores the old "owner and allow-list only" rule. Anyone refused is shown "this KoreMind does not accept new accounts". Accounts made through Kore ID have no password. Every account uses the owner's model providers and keys, so grant KoreMind access in Kore ID with that in mind.

### The owner

The owner is the account that can change providers and keys and create accounts with a password. It is always the **first account** on an empty KoreMind; later accounts are never owners.

- **Without `KOREMIND_OIDC_OWNER_EMAIL`**, the first account made by any route becomes the owner: the first Kore ID sign-in (whoever Kore ID lets in first) or the first password registration. Set KoreMind up right after deploying it, before granting anyone else access.
- **With `KOREMIND_OIDC_OWNER_EMAIL=me@example.com`**, an empty KoreMind accepts only a Kore ID sign-in with that email and `email_verified: true` as its first account; anyone else gets "this KoreMind isn't set up yet" (`owner_pending`), and the password setup form is closed (a password registration can't prove the email). Once the owner exists the setting does nothing.
- Existing instances keep their owner. Linking a Kore ID never changes who is owner.

## Existing users (migration)

Nothing is rewritten and no data is orphaned: chats, notes, uploads and settings hang off the local user id, which never changes. A Kore ID is attached to a local user by adding its `sub` to that row. Kore ID marks every email as verified (an admin typed it; only admins change emails), so:

1. **Automatic (default).** The first Kore ID sign-in whose email matches an existing local account, with `email_verified: true`, is linked to it: same data, same owner flag, the password keeps working. An account already linked to a different Kore ID is never re-pointed (`account_exists`). Turn off with `KOREMIND_OIDC_EMAIL_LINK=0`.
2. **Link while signed in.** Sign in with the old password, open **Settings → Account → Link Kore ID** (web and Android), sign in at Kore ID. Works for any email. Then, if you want, set `KOREMIND_PASSWORD_LOGIN=0`.
3. Manual: `sqlite3 koremind.sqlite "update users set oidc_sub='<sub>' where email='…'"`.

If automatic linking is off (or the email isn't verified) and the email already exists locally, the user gets "an account with this email already exists" instead of a duplicate.

## Back-channel logout

`POST /auth/backchannel-logout` (form field `logout_token`) implements OIDC Back-Channel Logout 1.0 for Kore ID. The token is accepted only if: its signature checks against Kore ID's JWKS, `iss` is `KOREMIND_OIDC_ISSUER`, `aud` is our client id, the header says `typ: logout+jwt`, it has `iat`, `exp` and `jti`, its `events` claim has `http://schemas.openid.net/event/backchannel-logout`, it has **no** `nonce`, it has a `sid` or `sub`, and its `jti` was not seen before (kept in the database until the token expires, so a replay is refused even after a restart). Then:

- with a `sid`: every KoreMind session from that Kore ID session ends, plus pending sign-in tickets and phone-pairing codes made from it;
- without a `sid`: every session of the account linked to that `sub` ends (password sessions too).

Answers: 200 (empty) when done, also when nothing matched; 400 `invalid_request` for a bad or replayed token; 503 when Kore ID's keys can't be fetched (Kore ID retries); 404 when Kore ID is off.

**Phones paired by QR code** from a Kore ID web session inherit its `sid`: signing out of Kore ID (or being disabled there) signs the phone out too, which is what "sign out everywhere" means. They do not inherit the web session's RP-logout URL, so signing out on the phone doesn't end the computer browser's Kore ID session. Phones that signed in with Kore ID themselves have their own `sid` (from the phone's browser).

## Android

The login screen shows **Continue with Kore ID** (and hides the password form when the server turns it off); the app asks the backend to start, opens the system browser, receives `koremind://sso?ticket=…` (intent filter on `MainActivity`), and trades the ticket with its own PKCE verifier. **Settings → Account → Link Kore ID** links the signed-in account (back as `koremind://sso?linked=1`). **Sign out** also opens the Kore ID logout URL in the browser when the session came from Kore ID. Unit tests cover the PKCE helper, link parsing and routing, and the logout response.

Not done: the custom scheme `koremind://` is not a verified App Link. None of this needs a separate Kore ID client, because the backend is the OIDC client. **Only if the app should talk to Kore ID directly** (no backend in between) it would need a public client such as:

```json
{ "id": "koremind-android", "name": "KoreMind (Android)", "app": "koremind", "redirectUris": ["dev.qarasky.koremind:/oauth2redirect"], "postLogoutRedirectUris": ["dev.qarasky.koremind:/signed-out"] }
```

with no `secretHash` (PKCE only).

## Limits and notes

- Kore ID access tokens live 10 minutes. KoreMind verifies them locally and does not call Kore ID's introspection endpoint, so disabling a user in Kore ID takes effect for API bearers within that time. KoreMind sessions made from a Kore ID login last 30 days like any other, but end as soon as Kore ID sends the back-channel logout for their `sid`. If Kore ID can't reach the backend (wrong `backchannelLogoutUri`, firewall), they don't: Kore ID logs the failed delivery.
- Discovery is cached for an hour (last good copy kept if Kore ID is briefly unreachable); the JWKS is cached and refreshed on unknown `kid`.
- Rate limits: 30 sign-in starts and 20 ticket exchanges per address per 15 minutes.
