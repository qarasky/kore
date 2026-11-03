import { createRemoteJWKSet, decodeProtectedHeader, errors, jwtVerify, type JWTPayload } from "jose";
import type { OidcConfig } from "./config";

/** The slice of Kore ID's discovery document KoreMind uses. */
export type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
  code_challenge_methods_supported?: string[];
};

export class OidcError extends Error {
  constructor(public code: "discovery" | "token_exchange" | "invalid_id_token" | "invalid_access_token" | "invalid_logout_token", message: string) {
    super(message);
  }
}

/** `sid` is the Kore ID browser session the sign-in belongs to (ties KoreMind sessions to it for back-channel logout). */
export type Identity = { sub: string; email?: string; emailVerified?: boolean; name?: string; sid?: string; idToken: string };

/** What a verified back-channel logout token asks for: end the sessions of `sid`, or (no sid) every session of `sub`. */
export type LogoutRequest = { sid?: string; sub?: string; jti: string };

const BACKCHANNEL_EVENT = "http://schemas.openid.net/event/backchannel-logout";

const DISCOVERY_TTL_MS = 3600_000;
export const b64url = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64url");
export const randomB64url = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
export const s256 = async (verifier: string) => b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));

/**
 * OpenID Connect relying party for Kore ID: discovery, authorization-code + PKCE (S256), id-token and access-token
 * verification against the provider's JWKS. `fetchImpl` and `jwks` are injectable so tests run without a network.
 */
export function createOidc(cfg: OidcConfig, deps: { fetch?: typeof fetch; now?: () => number; jwks?: Parameters<typeof jwtVerify>[1] } = {}) {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  let cached: { doc: Discovery; at: number } | null = null;
  let remoteJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  let remoteJwksUri = "";

  async function discovery(): Promise<Discovery> {
    if (cached && now() - cached.at < DISCOVERY_TTL_MS) return cached.doc;
    let doc: Discovery;
    try {
      const res = await doFetch(`${cfg.issuer}/.well-known/openid-configuration`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      doc = (await res.json()) as Discovery;
    } catch (e) {
      if (cached) return cached.doc; // keep working on the last good copy while Kore ID is unreachable
      throw new OidcError("discovery", `Could not read ${cfg.issuer}/.well-known/openid-configuration (${e instanceof Error ? e.message : "failed"})`);
    }
    // The document must describe the issuer we were configured with (mix-up / misconfiguration guard).
    if (doc.issuer !== cfg.issuer) throw new OidcError("discovery", `Discovery issuer ${String(doc.issuer)} does not match KOREMIND_OIDC_ISSUER ${cfg.issuer}`);
    for (const k of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) if (typeof doc[k] !== "string") throw new OidcError("discovery", `Discovery document has no ${k}`);
    if (doc.code_challenge_methods_supported && !doc.code_challenge_methods_supported.includes("S256")) throw new OidcError("discovery", "Provider does not support PKCE S256");
    cached = { doc, at: now() };
    return doc;
  }

  async function keys(): Promise<Parameters<typeof jwtVerify>[1]> {
    if (deps.jwks) return deps.jwks;
    const d = await discovery();
    if (!remoteJwks || remoteJwksUri !== d.jwks_uri) { remoteJwks = createRemoteJWKSet(new URL(d.jwks_uri), { cooldownDuration: 30_000, cacheMaxAge: 600_000 }); remoteJwksUri = d.jwks_uri; }
    return remoteJwks;
  }

  const verifyOpts = { issuer: cfg.issuer, audience: cfg.clientId, algorithms: ["EdDSA"], clockTolerance: 30, requiredClaims: ["sub", "exp", "iat"] };

  return {
    discovery,

    /** The URL to send the browser to. The caller keeps `state`, `nonce` and `verifier` and checks them on return. */
    async authorizationUrl(p: { state: string; nonce: string; verifier: string }): Promise<string> {
      const d = await discovery();
      const u = new URL(d.authorization_endpoint);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("client_id", cfg.clientId);
      u.searchParams.set("redirect_uri", cfg.redirectUri);
      u.searchParams.set("scope", cfg.scopes);
      u.searchParams.set("state", p.state);
      u.searchParams.set("nonce", p.nonce);
      u.searchParams.set("code_challenge", await s256(p.verifier));
      u.searchParams.set("code_challenge_method", "S256");
      return u.toString();
    },

    /** Trades the code for tokens and returns the verified identity from the id token. */
    async exchangeCode(p: { code: string; verifier: string; nonce: string }): Promise<Identity> {
      const d = await discovery();
      const form = new URLSearchParams({ grant_type: "authorization_code", code: p.code, redirect_uri: cfg.redirectUri, code_verifier: p.verifier, client_id: cfg.clientId });
      const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
      if (cfg.clientSecret) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString("base64")}`;
      let body: { id_token?: unknown; error?: string };
      try {
        const res = await doFetch(d.token_endpoint, { method: "POST", headers, body: form, signal: AbortSignal.timeout(10_000) });
        body = (await res.json()) as typeof body;
        if (!res.ok) throw new OidcError("token_exchange", `Token endpoint said ${body.error ?? res.status}`);
      } catch (e) {
        throw e instanceof OidcError ? e : new OidcError("token_exchange", "Could not reach the token endpoint");
      }
      if (typeof body.id_token !== "string") throw new OidcError("invalid_id_token", "Token response has no id_token");
      let payload: JWTPayload;
      try { payload = (await jwtVerify(body.id_token, (await keys()) as never, verifyOpts)).payload; }
      catch (e) { throw new OidcError("invalid_id_token", e instanceof errors.JOSEError ? e.message : "id_token could not be verified"); }
      if (payload.nonce !== p.nonce) throw new OidcError("invalid_id_token", "nonce mismatch");
      // An id token is a plain JWT: refuse access/logout tokens (typ at+jwt, logout+jwt) in its place, and tokens issued to another client.
      const typ = decodeProtectedHeader(body.id_token).typ;
      if (typ !== undefined && typ.toLowerCase() !== "jwt") throw new OidcError("invalid_id_token", `id_token has typ ${typ}`);
      if (payload.azp !== undefined && payload.azp !== cfg.clientId) throw new OidcError("invalid_id_token", "azp is not this client");
      return {
        sub: String(payload.sub),
        email: typeof payload.email === "string" ? payload.email.trim().toLowerCase() : undefined,
        emailVerified: typeof payload.email_verified === "boolean" ? payload.email_verified : undefined,
        name: typeof payload.name === "string" ? payload.name : undefined,
        sid: typeof payload.sid === "string" && payload.sid ? payload.sid : undefined,
        idToken: body.id_token,
      };
    },

    /**
     * Verifies a Kore ID *access* token presented as an API bearer (RFC 9068): header `typ: at+jwt` (so an id token or a
     * logout token never works as a bearer), signature, issuer, audience = this client, expiry. Returns the subject, or null.
     */
    async verifyAccessToken(token: string): Promise<{ sub: string; sid?: string } | null> {
      try {
        const { payload } = await jwtVerify(token, (await keys()) as never, { ...verifyOpts, typ: "at+jwt" });
        // Belt and braces: access tokens carry a scope and the client id, never a nonce.
        if (typeof payload.scope !== "string" || payload.nonce !== undefined) return null;
        if (payload.client_id !== undefined && payload.client_id !== cfg.clientId) return null;
        return { sub: String(payload.sub), sid: typeof payload.sid === "string" ? payload.sid : undefined };
      } catch { return null; }
    },

    /**
     * Verifies an OIDC Back-Channel Logout token: signature (JWKS), iss, aud = this client, header `typ: logout+jwt`, iat/exp/jti
     * present, the back-channel `events` member, no `nonce`, a `sid` or `sub`, and a `jti` not seen before (`seen` records it
     * until `exp`). Throws OidcError("invalid_logout_token") when any of that fails, OidcError("discovery") when Kore ID is down.
     */
    async verifyLogoutToken(token: string, seen: (jti: string, exp: number) => boolean): Promise<LogoutRequest> {
      const bad = (m: string) => new OidcError("invalid_logout_token", m);
      const k = await keys();
      let payload: JWTPayload;
      try {
        payload = (await jwtVerify(token, k as never, { issuer: cfg.issuer, audience: cfg.clientId, algorithms: ["EdDSA"], clockTolerance: 30, typ: "logout+jwt", requiredClaims: ["iat", "exp", "jti"] })).payload;
      } catch (e) { throw bad(e instanceof errors.JOSEError ? e.message : "logout token could not be verified"); }
      const events = payload.events as Record<string, unknown> | undefined;
      if (!events || typeof events !== "object" || Array.isArray(events) || !(BACKCHANNEL_EVENT in events)) throw bad("events claim missing");
      if ("nonce" in payload) throw bad("nonce is not allowed in a logout token");
      const sid = typeof payload.sid === "string" && payload.sid ? payload.sid : undefined;
      const sub = typeof payload.sub === "string" && payload.sub ? payload.sub : undefined;
      if (!sid && !sub) throw bad("sid or sub required");
      if (typeof payload.jti !== "string" || !payload.jti) throw bad("jti missing");
      if (seen(payload.jti, payload.exp!)) throw bad("logout token replayed");
      return { sid, sub, jti: payload.jti };
    },

    /** RP-initiated logout URL, or null when the provider has no end_session_endpoint. */
    async logoutUrl(idToken: string, postLogoutRedirectUri?: string): Promise<string | null> {
      const d = await discovery().catch(() => null);
      if (!d?.end_session_endpoint) return null;
      const u = new URL(d.end_session_endpoint);
      u.searchParams.set("id_token_hint", idToken);
      if (postLogoutRedirectUri) u.searchParams.set("post_logout_redirect_uri", postLogoutRedirectUri);
      return u.toString();
    },
  };
}
export type Oidc = ReturnType<typeof createOidc>;
