import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { loadConfig, type OidcConfig } from "../src/config";
import { openDb } from "../src/db";
import { FakeEngine } from "../src/engine/fake";
import { createApp } from "../src/http";
import { createOidc, s256 } from "../src/oidc";
import { createServices } from "../src/services";

const ISSUER = "https://id.kore.test";
const WEB = "http://localhost:3210";
const SECRET = "test-secret";
const keyPair = await generateKeyPair("EdDSA", { extractable: true });
const otherKey = await generateKeyPair("EdDSA");
const jwk = { ...(await exportJWK(keyPair.publicKey)), kid: "k1", alg: "EdDSA", use: "sig" };
const jwks = createLocalJWKSet({ keys: [jwk] });
const verifier = "v".repeat(43);

type Claims = { sub: string; email?: string; name?: string; email_verified?: boolean; sid?: string };
/** Signs like Kore ID. `typ`: "JWT" (id token, the default), "at+jwt" (access token), "logout+jwt"; null = no typ header. */
const sign = (claims: Record<string, unknown>, o: { aud?: string; iss?: string; exp?: number; key?: CryptoKey; typ?: string | null } = {}) =>
  new SignJWT(claims).setProtectedHeader({ alg: "EdDSA", kid: "k1", ...(o.typ === null ? {} : { typ: o.typ ?? "JWT" }) }).setIssuer(o.iss ?? ISSUER).setAudience(o.aud ?? "koremind").setIssuedAt().setExpirationTime(o.exp ?? Math.floor(Date.now() / 1000) + 600).sign(o.key ?? keyPair.privateKey);

/** A stand-in for Kore ID: discovery + token endpoint (checks the PKCE verifier and the client secret like the real one). */
function koreId(opts: { tamper?: (idClaims: Record<string, unknown>) => Record<string, unknown>; discoveryIssuer?: string; signWith?: CryptoKey; aud?: string; idTyp?: string | null } = {}) {
  const codes = new Map<string, { nonce: string; challenge: string; claims: Claims }>();
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration"))
      return Response.json({ issuer: opts.discoveryIssuer ?? ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/.well-known/jwks.json`, end_session_endpoint: `${ISSUER}/logout`, code_challenge_methods_supported: ["S256"] });
    if (url === `${ISSUER}/token`) {
      const body = new URLSearchParams(String(init?.body));
      const auth = (init?.headers as Record<string, string>).authorization;
      if (auth !== `Basic ${Buffer.from(`koremind:${SECRET}`).toString("base64")}`) return Response.json({ error: "invalid_client" }, { status: 401 });
      const c = codes.get(body.get("code") ?? "");
      codes.delete(body.get("code") ?? "");
      if (!c || body.get("redirect_uri") !== `${WEB.replace("3210", "8787")}/auth/callback`) return Response.json({ error: "invalid_grant" }, { status: 400 });
      if ((await s256(body.get("code_verifier") ?? "")) !== c.challenge) return Response.json({ error: "invalid_grant" }, { status: 400 });
      const claims: Record<string, unknown> = { sub: c.claims.sub, nonce: c.nonce, azp: "koremind", ...(c.claims.sid && { sid: c.claims.sid }), ...(c.claims.email && { email: c.claims.email }), ...(c.claims.name && { name: c.claims.name }), ...(c.claims.email_verified !== undefined && { email_verified: c.claims.email_verified }) };
      return Response.json({ token_type: "Bearer", id_token: await sign(opts.tamper ? opts.tamper(claims) : claims, { key: opts.signWith, aud: opts.aud, typ: opts.idTyp }), access_token: "unused" });
    }
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  /** What the browser does at Kore ID: logs `claims` in and returns the redirect back to the app. */
  const authorize = (authUrl: string, claims: Claims) => {
    const u = new URL(authUrl);
    expect(u.origin + u.pathname).toBe(`${ISSUER}/authorize`);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("client_id")).toBe("koremind");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("openid profile email");
    const code = crypto.randomUUID();
    codes.set(code, { nonce: u.searchParams.get("nonce")!, challenge: u.searchParams.get("code_challenge")!, claims });
    return `${u.searchParams.get("redirect_uri")}?code=${code}&state=${u.searchParams.get("state")}`;
  };
  return { fetchImpl, authorize };
}

const cfgOf = (o: Partial<OidcConfig> = {}): OidcConfig => ({
  issuer: ISSUER, clientId: "koremind", clientSecret: SECRET, scopes: "openid profile email", redirectUri: "http://localhost:8787/auth/callback",
  // The defaults of loadConfig (see the config tests).
  autoProvision: true, allowedEmails: [], emailLink: true, ownerEmail: "", backchannelLogoutUri: "http://localhost:8787/auth/backchannel-logout", webOrigins: [], ...o,
});

function setup(o: { oidc?: Partial<OidcConfig>; passwordLogin?: boolean; kore?: Parameters<typeof koreId>[0] } = {}) {
  const kore = koreId(o.kore);
  const oidc = cfgOf(o.oidc);
  const services = createServices({
    db: openDb(":memory:"), dataDir: mkdtempSync(join(tmpdir(), "koremind-sso-")), engine: new FakeEngine({ reply: () => [] }), version: "0.0.0-test",
    oidc, oidcClient: createOidc(oidc, { fetch: kore.fetchImpl, jwks: jwks as never }), passwordLogin: o.passwordLogin,
  });
  const app = createApp(services, { trustProxy: true });
  const call = (method: string, path: string, opts: { token?: string; body?: unknown } = {}) =>
    app.fetch(new Request("http://localhost:8787" + path, {
      method, redirect: "manual",
      headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.body ? { "content-type": "application/json" } : {}), "x-forwarded-for": "1.1.1.1" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }));
  /** Whole web sign-in: start, Kore ID, callback. Returns the URL the browser lands on. */
  const browserLogin = async (claims: Claims, extra: { platform?: "web" | "android"; token?: string; challenge?: string; returnTo?: string } = {}) => {
    const platform = extra.platform ?? "web";
    const r = await call("POST", "/auth/oidc/start", { token: extra.token, body: { challenge: extra.challenge ?? (await s256(verifier)), platform, ...(platform === "web" ? { returnTo: extra.returnTo ?? `${WEB}/login` } : {}) } });
    expect(r.status).toBe(200);
    const back = kore.authorize(((await r.json()) as { url: string }).url, claims);
    const cb = await call("GET", back.replace("http://localhost:8787", ""));
    return { cb, loc: cb.headers.get("location") ?? "", back };
  };
  const ticketOf = (loc: string) => new URL(loc.replace("#", "?")).searchParams.get("sso_ticket") ?? new URL(loc).searchParams.get("ticket") ?? "";
  const exchange = (ticket: string, v = verifier) => call("POST", "/auth/oidc/exchange", { body: { ticket, verifier: v } });
  return { call, services, browserLogin, ticketOf, exchange, kore };
}

const alice: Claims = { sub: "11111111-1111-4111-8111-111111111111", email: "Alice@Example.com", name: "Alice" };
const bob: Claims = { sub: "22222222-2222-4222-8222-222222222222", email: "bob@example.com", name: "Bob" };

describe("Kore ID web sign-in", () => {
  test("full flow: first Kore ID user becomes the owner, session works, logout gives the RP-initiated URL", async () => {
    const { call, browserLogin, ticketOf, exchange } = setup();
    const { cb, loc } = await browserLogin(alice);
    expect(cb.status).toBe(302);
    expect(loc.startsWith(`${WEB}/login#sso_ticket=`)).toBe(true);
    const res = await exchange(ticketOf(loc));
    expect(res.status).toBe(200);
    const { token, user } = (await res.json()) as { token: string; user: { email: string; isOwner: boolean; ssoLinked?: boolean } };
    expect(user).toMatchObject({ email: "alice@example.com", isOwner: true, ssoLinked: true });
    expect(await (await call("GET", "/me", { token })).json()).toMatchObject({ email: "alice@example.com" });
    const out = (await (await call("POST", "/auth/logout", { token })).json()) as { ok: boolean; logoutUrl?: string };
    const lu = new URL(out.logoutUrl!);
    expect(lu.origin + lu.pathname).toBe(`${ISSUER}/logout`);
    expect(lu.searchParams.get("id_token_hint")?.split(".")).toHaveLength(3);
    expect(lu.searchParams.get("post_logout_redirect_uri")).toBe(`${WEB}/login`);
    expect((await call("GET", "/me", { token })).status).toBe(401);
  });

  test("a returning user maps to the same account by sub, even if the email changed", async () => {
    const { browserLogin, ticketOf, exchange } = setup();
    const a = (await (await exchange(ticketOf((await browserLogin(alice)).loc))).json()) as { user: { id: string } };
    const b = (await (await exchange(ticketOf((await browserLogin({ ...alice, email: "new@example.com" })).loc))).json()) as { user: { id: string; email: string } };
    expect(b.user.id).toBe(a.user.id);
    expect(b.user.email).toBe("alice@example.com");
  });

  test("the ticket is single use and needs the client's PKCE verifier", async () => {
    const { browserLogin, ticketOf, exchange } = setup();
    const t = ticketOf((await browserLogin(alice)).loc);
    expect((await exchange(t, "w".repeat(43))).status).toBe(401); // wrong verifier burns the ticket
    expect((await exchange(t)).status).toBe(401);
    const t2 = ticketOf((await browserLogin(alice)).loc);
    expect((await exchange(t2)).status).toBe(200);
    expect((await exchange(t2)).status).toBe(401);
  });

  test("state is single use and unknown state is refused without a redirect", async () => {
    const { call, browserLogin } = setup();
    const { back } = await browserLogin(alice);
    const again = await call("GET", back.replace("http://localhost:8787", ""));
    expect(again.status).toBe(400);
    expect(again.headers.get("location")).toBeNull();
    expect((await call("GET", "/auth/callback?code=x&state=nope")).status).toBe(400);
    expect((await call("GET", "/auth/callback")).status).toBe(400);
  });

  test("a web origin that is not allowed cannot receive the sign-in", async () => {
    const { call } = setup();
    const r = await call("POST", "/auth/oidc/start", { body: { challenge: await s256(verifier), platform: "web", returnTo: "https://evil.example/login" } });
    expect(r.status).toBe(400);
    const ok = setup({ oidc: { webOrigins: ["https://koremind.example"] } });
    expect((await ok.call("POST", "/auth/oidc/start", { body: { challenge: await s256(verifier), platform: "web", returnTo: "https://koremind.example/login" } })).status).toBe(200);
    expect((await ok.call("POST", "/auth/oidc/start", { body: { challenge: await s256(verifier), platform: "web", returnTo: WEB + "/login" } })).status).toBe(400);
  });

  test("the user denying access comes back as sso_error", async () => {
    const { call } = setup();
    const r = await call("POST", "/auth/oidc/start", { body: { challenge: await s256(verifier), platform: "web", returnTo: `${WEB}/login` } });
    const state = new URL(((await r.json()) as { url: string }).url).searchParams.get("state");
    const cb = await call("GET", `/auth/callback?error=access_denied&state=${state}`);
    expect(cb.headers.get("location")).toBe(`${WEB}/login#sso_error=denied`);
  });
});

describe("Kore ID android sign-in", () => {
  test("returns to koremind://sso with a ticket", async () => {
    const { browserLogin, ticketOf, exchange } = setup();
    const { loc } = await browserLogin(alice, { platform: "android" });
    expect(loc.startsWith("koremind://sso?ticket=")).toBe(true);
    expect((await exchange(ticketOf(loc))).status).toBe(200);
  });
});

describe("id token verification", () => {
  const rejected = async (kore: Parameters<typeof koreId>[0]) => {
    const t = setup({ kore });
    const { loc } = await t.browserLogin(alice);
    expect(loc).toBe(`${WEB}/login#sso_error=provider_error`);
    expect(t.services.db.query("select count(*) c from users").get()).toEqual({ c: 0 });
  };
  test("wrong nonce", () => rejected({ tamper: (c) => ({ ...c, nonce: "other" }) }));
  test("missing nonce", () => rejected({ tamper: ({ nonce: _n, ...c }) => c }));
  test("wrong audience", () => rejected({ aud: "korecalendar" }));
  test("signed by someone else", () => rejected({ signWith: otherKey.privateKey }));
  test("an access token (typ at+jwt) in place of the id token", () => rejected({ idTyp: "at+jwt" }));
  test("a logout token (typ logout+jwt) in place of the id token", () => rejected({ idTyp: "logout+jwt" }));
  test("issued to another client (azp)", () => rejected({ tamper: (c) => ({ ...c, azp: "korecalendar" }) }));
  test("an id token without a typ header is still fine", async () => {
    const t = setup({ kore: { idTyp: null } });
    expect((await t.exchange(t.ticketOf((await t.browserLogin(alice)).loc))).status).toBe(200);
  });
  test("discovery issuer does not match the configured one", async () => {
    const t = setup({ kore: { discoveryIssuer: "https://evil.example" } });
    const r = await t.call("POST", "/auth/oidc/start", { body: { challenge: await s256(verifier), platform: "android" } });
    expect(r.status).toBe(400);
  });
});

describe("provisioning policy", () => {
  test("by default anyone Kore ID lets in gets an account; only the first is the owner", async () => {
    const t = setup();
    const a = (await (await t.exchange(t.ticketOf((await t.browserLogin(alice)).loc))).json()) as { user: { isOwner: boolean } };
    const b = (await (await t.exchange(t.ticketOf((await t.browserLogin(bob)).loc))).json()) as { user: { isOwner: boolean } };
    expect(a.user.isOwner).toBe(true);
    expect(b.user.isOwner).toBe(false);
  });
  test("KOREMIND_OIDC_AUTO_PROVISION=0: a second, unknown Kore ID user is refused", async () => {
    const t = setup({ oidc: { autoProvision: false } });
    await t.exchange(t.ticketOf((await t.browserLogin(alice)).loc));
    expect((await t.browserLogin(bob)).loc).toBe(`${WEB}/login#sso_error=not_allowed`);
  });
  test("the allow-list (email or @domain) admits listed users only, including the first", async () => {
    const t = setup({ oidc: { allowedEmails: ["bob@example.com", "@corp.test"] } });
    expect((await t.browserLogin(alice)).loc).toBe(`${WEB}/login#sso_error=not_allowed`);
    expect((await t.exchange(t.ticketOf((await t.browserLogin(bob)).loc))).status).toBe(200);
    expect((await t.exchange(t.ticketOf((await t.browserLogin({ sub: "33333333-3333-4333-8333-333333333333", email: "x@corp.test" })).loc))).status).toBe(200);
  });
  test("KOREMIND_OIDC_OWNER_EMAIL pins the owner of an empty instance to that verified email", async () => {
    const t = setup({ oidc: { ownerEmail: "bob@example.com" } });
    expect((await t.browserLogin(alice)).loc).toBe(`${WEB}/login#sso_error=owner_pending`);
    expect((await t.browserLogin(bob)).loc).toBe(`${WEB}/login#sso_error=owner_pending`); // email_verified missing
    // password setup of the first account is closed: it could claim the owner's email without proving it
    expect((await t.call("POST", "/auth/register", { body: { email: "bob@example.com", password: "correct horse" } })).status).toBe(403);
    expect(t.services.db.query("select count(*) c from users").get()).toEqual({ c: 0 });
    const b = (await (await t.exchange(t.ticketOf((await t.browserLogin({ ...bob, email_verified: true })).loc))).json()) as { user: { isOwner: boolean } };
    expect(b.user.isOwner).toBe(true);
    const a = (await (await t.exchange(t.ticketOf((await t.browserLogin(alice)).loc))).json()) as { user: { isOwner: boolean } };
    expect(a.user.isOwner).toBe(false);
  });
  test("no email, or an unverified one, is refused", async () => {
    const t = setup();
    expect((await t.browserLogin({ sub: "44444444-4444-4444-8444-444444444444" })).loc).toBe(`${WEB}/login#sso_error=no_email`);
    expect((await t.browserLogin({ ...alice, email_verified: false })).loc).toBe(`${WEB}/login#sso_error=no_email`);
  });
});

describe("existing local accounts", () => {
  const withLocalOwner = async (o: Parameters<typeof setup>[0] = {}) => {
    const t = setup(o);
    const r = (await (await t.call("POST", "/auth/register", { body: { email: "alice@example.com", password: "correct horse" } })).json()) as { token: string };
    return { ...t, localToken: r.token };
  };
  test("same email without email_verified: true is NOT linked", async () => {
    const t = await withLocalOwner();
    expect((await t.browserLogin(alice)).loc).toBe(`${WEB}/login#sso_error=account_exists`);
    expect((await t.browserLogin({ ...alice, email_verified: false })).loc).toBe(`${WEB}/login#sso_error=no_email`);
    expect(t.services.auth.userBySub(alice.sub)).toBeNull();
  });
  test("KOREMIND_OIDC_EMAIL_LINK=0: not linked even when verified", async () => {
    const t = await withLocalOwner({ oidc: { emailLink: false } });
    expect((await t.browserLogin({ ...alice, email_verified: true })).loc).toBe(`${WEB}/login#sso_error=account_exists`);
  });
  test("by default a verified email links to the existing account and keeps the data and owner flag", async () => {
    const t = await withLocalOwner();
    const me = (await (await t.call("GET", "/me", { token: t.localToken })).json()) as { id: string };
    const r = (await (await t.exchange(t.ticketOf((await t.browserLogin({ ...alice, email_verified: true })).loc))).json()) as { user: { id: string; isOwner: boolean } };
    expect(r.user).toMatchObject({ id: me.id, isOwner: true });
    // the password still works too
    expect((await t.call("POST", "/auth/login", { body: { email: "alice@example.com", password: "correct horse" } })).status).toBe(200);
  });
  test("a signed-in user can link their own Kore ID, then signs in with it", async () => {
    const t = await withLocalOwner();
    const me = (await (await t.call("GET", "/me", { token: t.localToken })).json()) as { id: string };
    const { loc } = await t.browserLogin({ ...alice, email: "other@example.com" }, { token: t.localToken });
    expect(loc).toBe(`${WEB}/login#sso_linked=1`);
    expect(t.services.auth.userBySub(alice.sub)?.id).toBe(me.id);
    const r = (await (await t.exchange(t.ticketOf((await t.browserLogin(alice)).loc))).json()) as { user: { id: string } };
    expect(r.user.id).toBe(me.id);
  });
  test("a verified email never re-points an account already linked to another Kore ID", async () => {
    const t = setup();
    await t.exchange(t.ticketOf((await t.browserLogin(alice)).loc));
    expect((await t.browserLogin({ sub: "55555555-5555-4555-8555-555555555555", email: alice.email, email_verified: true })).loc).toBe(`${WEB}/login#sso_error=account_exists`);
  });
  test("a Kore ID already linked to someone else cannot be linked again", async () => {
    const t = setup();
    const owner = (await (await t.exchange(t.ticketOf((await t.browserLogin(alice)).loc))).json()) as { token: string };
    const local = (await (await t.call("POST", "/auth/register", { token: owner.token, body: { email: "c@example.com", password: "correct horse" } })).json()) as { token: string };
    expect((await t.browserLogin(alice, { token: local.token })).loc).toBe(`${WEB}/login#sso_error=sub_taken`);
    // an account already linked to a different Kore ID cannot be re-pointed
    const bobToken = (await (await t.exchange(t.ticketOf((await t.browserLogin(bob)).loc))).json()) as { token: string };
    expect((await t.browserLogin(alice, { token: bobToken.token })).loc).toBe(`${WEB}/login#sso_error=already_linked`);
  });
});

describe("password login switch", () => {
  test("Kore ID accounts have no password", async () => {
    const t = setup();
    await t.exchange(t.ticketOf((await t.browserLogin(alice)).loc));
    expect((await t.call("POST", "/auth/login", { body: { email: "alice@example.com", password: "" .padEnd(12, "x") } })).status).toBe(401);
  });
  test("passwordLogin=false refuses register and login but SSO and /health still work", async () => {
    const t = setup({ passwordLogin: false });
    expect(await (await t.call("GET", "/health")).json()).toMatchObject({ sso: true, passwordLogin: false });
    expect((await t.call("POST", "/auth/register", { body: { email: "a@b.co", password: "correct horse" } })).status).toBe(403);
    expect((await t.call("POST", "/auth/login", { body: { email: "a@b.co", password: "correct horse" } })).status).toBe(403);
    expect((await t.exchange(t.ticketOf((await t.browserLogin(alice)).loc))).status).toBe(200);
  });
  test("pairing still works for SSO sessions", async () => {
    const t = setup();
    const { token } = (await (await t.exchange(t.ticketOf((await t.browserLogin(alice)).loc))).json()) as { token: string };
    const pair = (await (await t.call("POST", "/auth/pair", { token })).json()) as { code: string };
    expect((await t.call("POST", "/auth/pair/redeem", { body: { code: pair.code } })).status).toBe(200);
  });
});

describe("Kore ID access token as API bearer", () => {
  const linked = async () => {
    const t = setup();
    await t.exchange(t.ticketOf((await t.browserLogin(alice)).loc));
    return t;
  };
  const access = (sub: string, o: Parameters<typeof sign>[1] = {}, extra: Record<string, unknown> = {}) =>
    sign({ sub, client_id: "koremind", scope: "openid profile email", sid: "s-1", jti: crypto.randomUUID(), email: "alice@example.com", ...extra }, { typ: "at+jwt", ...o });

  test("accepted for a linked sub", async () => {
    const t = await linked();
    const res = await t.call("GET", "/me", { token: await access(alice.sub) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: "alice@example.com", isOwner: true });
  });
  test("rejected: unlinked sub, wrong audience, wrong issuer, expired, foreign key, id token, garbage", async () => {
    const t = await linked();
    const status = async (tok: string) => (await t.call("GET", "/me", { token: tok })).status;
    expect(await status(await access(bob.sub))).toBe(401);
    expect(await status(await access(alice.sub, { aud: "korecalendar" }))).toBe(401);
    expect(await status(await access(alice.sub, { iss: "https://evil.example" }))).toBe(401);
    expect(await status(await access(alice.sub, { exp: Math.floor(Date.now() / 1000) - 3600 }))).toBe(401);
    expect(await status(await access(alice.sub, { key: otherKey.privateKey }))).toBe(401);
    expect(await status(await sign({ sub: alice.sub, nonce: "n", email: "alice@example.com" }))).toBe(401); // an id token
    expect(await status("a.b.c")).toBe(401);
  });
  test("rejected unless the header says typ at+jwt, even with every claim right", async () => {
    const t = await linked();
    const status = async (tok: string) => (await t.call("GET", "/me", { token: tok })).status;
    expect(await status(await access(alice.sub, { typ: "JWT" }))).toBe(401); // id-token typ, but scope and all
    expect(await status(await access(alice.sub, { typ: null }))).toBe(401);
    expect(await status(await access(alice.sub, { typ: "logout+jwt" }))).toBe(401);
    expect(await status(await access(alice.sub, { typ: "application/at+jwt" }))).toBe(200); // RFC 9068 long form
    expect(await status(await access(alice.sub, {}, { client_id: "korecalendar" }))).toBe(401);
  });
  test("not accepted at all when Kore ID is off", async () => {
    const s = createServices({ db: openDb(":memory:"), dataDir: mkdtempSync(join(tmpdir(), "koremind-sso-")), engine: new FakeEngine({ reply: () => [] }), version: "t" });
    const app = createApp(s);
    const res = await app.fetch(new Request("http://x/me", { headers: { authorization: `Bearer ${await access(alice.sub)}` } }));
    expect(res.status).toBe(401);
  });
});

test("the routes answer 404 when Kore ID is not configured", async () => {
  const s = createServices({ db: openDb(":memory:"), dataDir: mkdtempSync(join(tmpdir(), "koremind-sso-")), engine: new FakeEngine({ reply: () => [] }), version: "t" });
  const app = createApp(s);
  const r = await app.fetch(new Request("http://x/auth/oidc/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challenge: "a".repeat(43), platform: "android" }) }));
  expect(r.status).toBe(404);
});

describe("config", () => {
  test("Kore ID is off unless the issuer is set, and password login cannot be turned off then", () => {
    const c = loadConfig({ KOREMIND_PASSWORD_LOGIN: "0" });
    expect(c.oidc).toBeNull();
    expect(c.passwordLogin).toBe(true);
  });
  test("defaults and overrides", () => {
    const c = loadConfig({ KOREMIND_PORT: "9000", KOREMIND_OIDC_ISSUER: "https://id.kore.test/", KOREMIND_OIDC_CLIENT_SECRET: " s ", KOREMIND_PUBLIC_URL: "https://api.example.com/", KOREMIND_PASSWORD_LOGIN: "false", KOREMIND_OIDC_ALLOWED_EMAILS: "A@b.c, @d.e", KOREMIND_WEB_ORIGINS: "https://app.example.com/" });
    expect(c.passwordLogin).toBe(false);
    expect(c.oidc).toMatchObject({ issuer: "https://id.kore.test", clientId: "koremind", clientSecret: "s", redirectUri: "https://api.example.com/auth/callback", backchannelLogoutUri: "https://api.example.com/auth/backchannel-logout", scopes: "openid profile email", autoProvision: true, emailLink: true, ownerEmail: "", allowedEmails: ["a@b.c", "@d.e"], webOrigins: ["https://app.example.com"] });
  });
  test("provisioning switches, the owner pin, and the old name of the email-link switch", () => {
    const base = { KOREMIND_OIDC_ISSUER: "https://id.kore.test" };
    expect(loadConfig({ ...base, KOREMIND_OIDC_AUTO_PROVISION: "0", KOREMIND_OIDC_EMAIL_LINK: "0", KOREMIND_OIDC_OWNER_EMAIL: " Owner@X.org " }).oidc).toMatchObject({ autoProvision: false, emailLink: false, ownerEmail: "owner@x.org" });
    expect(loadConfig({ ...base, KOREMIND_OIDC_TRUST_EMAIL_LINK: "0" }).oidc?.emailLink).toBe(false);
    expect(loadConfig({ ...base, KOREMIND_OIDC_TRUST_EMAIL_LINK: "0", KOREMIND_OIDC_EMAIL_LINK: "1" }).oidc?.emailLink).toBe(true);
  });
  test("the secret can come from a file", () => {
    const c = loadConfig({ KOREMIND_OIDC_ISSUER: "https://id.kore.test", KOREMIND_OIDC_CLIENT_SECRET_FILE: "/run/secrets/x" }, (p) => (p === "/run/secrets/x" ? "from-file\n" : ""));
    expect(c.oidc?.clientSecret).toBe("from-file");
  });
  test("a non-URL issuer is an error", () => {
    expect(() => loadConfig({ KOREMIND_OIDC_ISSUER: "id.kore.test" })).toThrow();
  });
});

describe("back-channel logout", () => {
  const EVENT = { "http://schemas.openid.net/event/backchannel-logout": {} };
  const logoutToken = (claims: Record<string, unknown>, o: Parameters<typeof sign>[1] = {}) =>
    sign({ jti: crypto.randomUUID(), events: EVENT, ...claims }, { typ: "logout+jwt", exp: Math.floor(Date.now() / 1000) + 120, ...o });
  const post = (t: ReturnType<typeof setup>, body: string, type = "application/x-www-form-urlencoded") =>
    t.services && createApp(t.services, { trustProxy: true }).fetch(new Request("http://localhost:8787/auth/backchannel-logout", { method: "POST", headers: { "content-type": type }, body }));
  const send = (t: ReturnType<typeof setup>, token: string) => post(t, new URLSearchParams({ logout_token: token }).toString());
  const signIn = async (t: ReturnType<typeof setup>, c: Claims) => ((await (await t.exchange(t.ticketOf((await t.browserLogin(c)).loc))).json()) as { token: string }).token;
  const alive = async (t: ReturnType<typeof setup>, token: string) => (await t.call("GET", "/me", { token })).status === 200;

  test("ends every session of that Kore ID session, including a phone paired from it, and nothing else", async () => {
    const t = setup();
    const web1 = await signIn(t, { ...alice, sid: "kore-sid-1" });
    const web2 = await signIn(t, { ...alice, sid: "kore-sid-2" });
    const bobs = await signIn(t, { ...bob, sid: "kore-sid-3" });
    const pair = (await (await t.call("POST", "/auth/pair", { token: web1 })).json()) as { code: string };
    const phone = ((await (await t.call("POST", "/auth/pair/redeem", { body: { code: pair.code } })).json()) as { token: string }).token;
    expect(t.services.db.query("select sid from tokens where sid is not null order by sid").all()).toEqual([{ sid: "kore-sid-1" }, { sid: "kore-sid-1" }, { sid: "kore-sid-2" }, { sid: "kore-sid-3" }]);
    // The phone does not get the computer's RP-logout URL.
    expect(((await (await t.call("POST", "/auth/logout", { token: phone })).json()) as { logoutUrl?: string }).logoutUrl).toBeUndefined();
    const phone2 = ((await (await t.call("POST", "/auth/pair/redeem", { body: { code: ((await (await t.call("POST", "/auth/pair", { token: web1 })).json()) as { code: string }).code } })).json()) as { token: string }).token;

    const r = await send(t, await logoutToken({ sub: alice.sub, sid: "kore-sid-1" }));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await alive(t, web1)).toBe(false);
    expect(await alive(t, phone2)).toBe(false);
    expect(await alive(t, web2)).toBe(true);
    expect(await alive(t, bobs)).toBe(true);
  });

  test("without a sid it ends every session of the account linked to that sub (password sessions too)", async () => {
    const t = setup();
    const pw = ((await (await t.call("POST", "/auth/register", { body: { email: "alice@example.com", password: "correct horse" } })).json()) as { token: string }).token;
    const sso = await signIn(t, { ...alice, email_verified: true, sid: "kore-sid-1" }); // links by verified email
    const bobs = await signIn(t, bob);
    expect((await send(t, await logoutToken({ sub: alice.sub }))).status).toBe(200);
    expect(await alive(t, sso)).toBe(false);
    expect(await alive(t, pw)).toBe(false);
    expect(await alive(t, bobs)).toBe(true);
    // an unknown sub is fine (nothing to end), still 200
    expect((await send(t, await logoutToken({ sub: "99999999-9999-4999-8999-999999999999" }))).status).toBe(200);
  });

  test("a pending sign-in ticket from the ended session is useless", async () => {
    const t = setup();
    const ticket = t.ticketOf((await t.browserLogin({ ...alice, sid: "kore-sid-9" })).loc);
    expect((await send(t, await logoutToken({ sid: "kore-sid-9", sub: alice.sub }))).status).toBe(200);
    expect((await t.exchange(ticket)).status).toBe(401);
  });

  test("a replayed logout token (same jti) is refused", async () => {
    const t = setup();
    const tok = await logoutToken({ sub: alice.sub, sid: "x" });
    expect((await send(t, tok)).status).toBe(200);
    expect((await send(t, tok)).status).toBe(400);
  });

  test("invalid logout tokens get 400 and end nothing", async () => {
    const t = setup();
    const web = await signIn(t, { ...alice, sid: "kore-sid-1" });
    const claims = { sub: alice.sub, sid: "kore-sid-1" };
    const { events: _e, ...noEvents } = { ...claims, events: EVENT };
    const bad = [
      await logoutToken(claims, { aud: "korecalendar" }),
      await logoutToken(claims, { iss: "https://evil.example" }),
      await logoutToken(claims, { typ: "JWT" }),
      await logoutToken(claims, { typ: "at+jwt" }),
      await logoutToken(claims, { typ: null }),
      await logoutToken(claims, { key: otherKey.privateKey }),
      await logoutToken(claims, { exp: Math.floor(Date.now() / 1000) - 600 }),
      await logoutToken({ ...claims, nonce: "n" }),
      await logoutToken({ ...claims, events: { "http://example.com/other": {} } }),
      await sign({ ...noEvents, jti: "j1" }, { typ: "logout+jwt" }),
      await sign({ ...claims, events: EVENT }, { typ: "logout+jwt" }), // no jti
      await logoutToken({}), // neither sid nor sub
      "not.a.jwt",
    ];
    for (const tok of bad) expect((await send(t, tok)).status).toBe(400);
    expect((await post(t, "nothing=here"))!.status).toBe(400);
    expect((await post(t, "", "text/plain"))!.status).toBe(400);
    expect(await alive(t, web)).toBe(true);
  });

  test("404 when Kore ID is not configured", async () => {
    const s = createServices({ db: openDb(":memory:"), dataDir: mkdtempSync(join(tmpdir(), "koremind-sso-")), engine: new FakeEngine({ reply: () => [] }), version: "t" });
    const r = await createApp(s).fetch(new Request("http://x/auth/backchannel-logout", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "logout_token=a.b.c" }));
    expect(r.status).toBe(404);
  });
});
