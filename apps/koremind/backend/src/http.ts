import { ApprovalAnswer, AuthRequest, PairRedeem, Settings, SsoExchange, SsoStart, SendMessageRequest, type PairStart, type StreamEvent } from "@koremind/shared";
import { z } from "zod";
import { AuthError } from "./auth";
import type { Services } from "./services";
import { UploadError } from "./uploads";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
const fail = (status: number, code: string, message: string, extra: object = {}) => json(status, { error: { code, message, ...extra } });
const ok = () => json(200, { ok: true });

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const isLoopback = (ip?: string) => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";

export function createApp(s: Services, opts: { trustProxy?: boolean; keepAliveMs?: number } = {}) {
  const keepAliveMs = opts.keepAliveMs ?? 15_000;
  async function body<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
    let raw: unknown;
    try { raw = await req.json(); } catch { throw new HttpError(400, "bad_request", "Invalid JSON"); }
    const r = schema.safeParse(raw);
    if (!r.success) throw new HttpError(400, "bad_request", r.error.issues[0]?.message ?? "Invalid request");
    return r.data;
  }
  const tokenOf = (req: Request, url: URL) => req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("token") ?? "";

  async function route(req: Request, socketIp?: string): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const m = req.method;
    if (m === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (m === "GET" && path === "/health") return json(200, { name: "koremind", version: s.version, setupRequired: s.auth.setupRequired(), sso: !!s.sso, passwordLogin: s.auth.passwordLogin });

    // A tunnel (cloudflared, tailscale serve) on this machine arrives from loopback: believe its forwarded address, nobody else's.
    const ip = (opts.trustProxy || isLoopback(socketIp) ? req.headers.get("x-forwarded-for")?.split(",")[0].trim() : undefined) ?? socketIp ?? "unknown";
    const bearer = tokenOf(req, url);
    // KoreMind's own opaque session token, or (when Kore ID is on) a Kore ID access token for this app: a JWT has two dots, ours has none.
    const caller = s.auth.verify(bearer) ?? (s.sso && bearer.split(".").length === 3 ? await s.sso.verifyBearer(bearer) : null);

    // Kore ID sign-in. The callback is a browser redirect from Kore ID, so it carries no token.
    if (m === "GET" && path === "/auth/callback" && s.sso) {
      const r = await s.sso.callback({ code: url.searchParams.get("code") ?? undefined, state: url.searchParams.get("state") ?? undefined, error: url.searchParams.get("error") ?? undefined });
      if (r.kind === "web" && !r.returnTo) return new Response("<!doctype html><meta charset=utf-8><title>KoreMind</title><p>This sign-in link has expired or was already used. Go back to KoreMind and try again.", { status: 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
      const p = r.error ? ["sso_error", r.error] : r.ticket ? ["sso_ticket", r.ticket] : ["sso_linked", "1"];
      const to = r.kind === "web" ? `${r.returnTo}#${p[0]}=${encodeURIComponent(p[1])}` : `koremind://sso?${p[0].replace("sso_", "")}=${encodeURIComponent(p[1])}`;
      return new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
    }
    if (m === "POST" && path === "/auth/oidc/start") {
      if (!s.sso) return fail(404, "not_found", "Kore ID sign-in is not configured");
      return json(200, { url: await s.sso.start(await body(req, SsoStart), ip, caller ?? undefined) });
    }
    if (m === "POST" && path === "/auth/oidc/exchange") {
      if (!s.sso) return fail(404, "not_found", "Kore ID sign-in is not configured");
      const b = await body(req, SsoExchange);
      return json(200, await s.sso.exchange(b.ticket, b.verifier, ip));
    }

    if (m === "POST" && path === "/auth/register") return json(200, await s.auth.register(await body(req, AuthRequest), caller ?? undefined));
    if (m === "POST" && path === "/auth/login") return json(200, await s.auth.login(await body(req, AuthRequest), ip));

    // The local OpenCode engine reaches the notes tools here. Loopback only, and it must know the per-run secret.
    if (path === "/mcp") {
      if (!isLoopback(socketIp)) return fail(403, "forbidden", "Local only");
      if (req.headers.get("authorization") !== `Bearer ${s.mcpSecret}`) return fail(401, "unauthorized", "Bad secret");
      if (m !== "POST") return new Response(null, { status: m === "DELETE" ? 200 : 405 });
      let raw: unknown;
      try { raw = await req.json(); } catch { return json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
      const r = await s.mcp.handle(raw);
      return r.body === undefined ? new Response(null, { status: r.status }) : json(r.status, r.body);
    }

    if (m === "POST" && path === "/auth/pair/redeem") return json(200, await s.auth.redeemPair((await body(req, PairRedeem)).code, ip));

    if (!caller) return fail(401, "unauthorized", "Sign in required");
    const u = caller.id;
    let r: RegExpMatchArray | null;

    if (m === "POST" && path === "/auth/logout") { const logoutUrl = s.auth.logout(bearer); return json(200, { ok: true, ...(logoutUrl ? { logoutUrl } : {}) }); }
    if (m === "POST" && path === "/auth/pair") {
      const { code, expiresAt } = s.auth.startPair(u);
      const urls = s.addresses();
      const link = `koremind://pair?${[`c=${encodeURIComponent(code)}`, ...urls.map((x) => `u=${encodeURIComponent(x)}`)].join("&")}`;
      const out: PairStart = { code, expiresAt, urls, link };
      return json(200, out);
    }
    if (m === "GET" && path === "/me") return json(200, caller);
    if (m === "GET" && path === "/models") return json(200, await s.models.providers(u));
    if (m === "GET" && path === "/favorites") return json(200, s.models.favorites(u));
    if (m === "PUT" && path === "/favorites") { await s.models.setFavorites(u, await body(req, z.array(z.string()))); return json(200, s.models.favorites(u)); }
    if (m === "GET" && path === "/providers") return json(200, await s.models.connections());
    if ((r = path.match(/^\/providers\/([^/]+)\/signin(?:\/([^/]+))?$/))) {
      if (!caller.isOwner) return fail(403, "forbidden", "Only the owner can change providers");
      const pid = decodeURIComponent(r[1]);
      if (m === "POST" && !r[2]) {
        try { return json(200, await s.models.startSignIn(pid)); }
        catch (e) { return fail(502, "engine_error", e instanceof Error ? e.message : "Could not start sign-in"); }
      }
      if (m === "GET" && r[2]) return json(200, await s.models.signInStatus(pid, decodeURIComponent(r[2])));
    }
    if ((r = path.match(/^\/providers\/([^/]+)\/key$/))) {
      if (!caller.isOwner) return fail(403, "forbidden", "Only the owner can change provider keys");
      if (m === "PUT") { await s.models.connect(decodeURIComponent(r[1]), (await body(req, z.object({ key: z.string().min(1) }))).key); return ok(); }
      if (m === "DELETE") { await s.models.disconnect(decodeURIComponent(r[1])); return ok(); }
    }

    if (m === "GET" && path === "/chats") return json(200, s.chats.list(u));
    if (m === "POST" && path === "/chats") return json(200, s.chats.create(u));
    if ((r = path.match(/^\/chats\/([^/]+)$/))) {
      const id = r[1];
      if (!s.chats.has(u, id)) return fail(404, "not_found", "Chat not found");
      if (m === "GET") return json(200, s.chats.get(u, id));
      if (m === "PATCH") { s.chats.rename(u, id, (await body(req, z.object({ title: z.string() }))).title); return ok(); }
      if (m === "DELETE") { await s.chats.remove(u, id); return ok(); }
    }
    if ((r = path.match(/^\/chats\/([^/]+)\/approvals\/([^/]+)$/)) && m === "POST") {
      if (!s.chats.has(u, r[1])) return fail(404, "not_found", "Chat not found");
      const { allow } = await body(req, ApprovalAnswer);
      if (!s.approvals.answer(u, r[1], decodeURIComponent(r[2]), allow)) return fail(404, "not_found", "That request is no longer open");
      return ok();
    }
    if ((r = path.match(/^\/chats\/([^/]+)\/abort$/)) && m === "POST") {
      if (!s.chats.has(u, r[1])) return fail(404, "not_found", "Chat not found");
      s.chats.abort(r[1]);
      return ok();
    }
    if ((r = path.match(/^\/chats\/([^/]+)\/messages$/)) && m === "POST") {
      if (!s.chats.has(u, r[1])) return fail(404, "not_found", "Chat not found");
      const sendReq = await body(req, SendMessageRequest);
      if (!(await s.models.allowed(u, sendReq.model.providerId, sendReq.model.modelId))) return fail(400, "model_not_allowed", "That model isn't available. Pick another one in the model picker.");
      const it = s.chats.send(u, r[1], sendReq, req.signal)[Symbol.asyncIterator]();
      const enc = new TextEncoder();
      let nextEv: Promise<IteratorResult<StreamEvent>> | null = null;
      const stream = new ReadableStream<Uint8Array>({
        async pull(c) {
          nextEv ??= it.next();
          for (;;) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const r = await Promise.race([nextEv, new Promise<null>((res) => { timer = setTimeout(() => res(null), keepAliveMs); })]);
            clearTimeout(timer);
            if (r === null) { c.enqueue(enc.encode(": ping\n\n")); continue; }
            nextEv = null;
            if (r.done) c.close(); else c.enqueue(enc.encode(`data: ${JSON.stringify(r.value)}\n\n`));
            return;
          }
        },
        async cancel() { await it.return?.(undefined); },
      });
      return new Response(stream, { headers: { ...CORS, "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" } });
    }

    if (m === "POST" && path === "/uploads") {
      const file = (await req.formData().catch(() => null))?.get("file");
      if (!(file instanceof File)) return fail(400, "bad_request", "Send a file in the 'file' field");
      try { return json(200, await s.uploads.save(u, file)); }
      catch (e) {
        if (e instanceof UploadError) return e.code === "too_large" ? fail(413, "attachment_too_large", e.message) : fail(415, "unsupported", e.message);
        throw e;
      }
    }
    if ((r = path.match(/^\/uploads\/([^/]+)$/)) && m === "GET") {
      const res = s.uploads.stream(r[1], u);
      if (!res) return fail(404, "not_found", "File not found");
      for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
      return res;
    }

    if (m === "GET" && path === "/memory") return json(200, s.memory.list(u));
    if ((r = path.match(/^\/memory\/([^/]+)$/))) {
      if (m === "PUT") { s.memory.update(u, r[1], (await body(req, z.object({ text: z.string() }))).text); return ok(); }
      if (m === "DELETE") { s.memory.remove(u, r[1]); return ok(); }
    }
    if (m === "GET" && path === "/settings") return json(200, s.settings.get(u));
    if (m === "PUT" && path === "/settings") { const v = await body(req, Settings); s.settings.put(u, v); return json(200, v); }

    return fail(404, "not_found", "No such route");
  }

  return {
    async fetch(req: Request, socketIp?: string): Promise<Response> {
      try { return await route(req, socketIp); }
      catch (e) {
        if (e instanceof HttpError) return fail(e.status, e.code, e.message);
        if (e instanceof AuthError) {
          const status = e.code === "rate_limited" ? 429 : e.code === "setup_closed" || e.code === "password_disabled" ? 403 : e.code === "sso_failed" ? 400 : 401; // bad_code and bad_credentials: 401
          return fail(status, e.code, e.message, e.retryAfterSec ? { retryAfterSec: e.retryAfterSec } : {});
        }
        if (e instanceof Error && /UNIQUE constraint/.test(e.message)) return fail(409, "conflict", "That email is already registered");
        console.error("unhandled", e instanceof Error ? e.message : e);
        return fail(500, "internal", "Something went wrong");
      }
    },
  };
}
