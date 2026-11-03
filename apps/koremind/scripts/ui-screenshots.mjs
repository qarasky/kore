// Screenshots of the main web screens, for design reviews (docs/screenshots/…).
//
//   (cd web && bun run build)
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.js node scripts/ui-screenshots.mjs docs/screenshots/kore-ui-migration/after
//
// Starts a throw-away backend (fake engine, temp data dir, Kore ID "configured" against a dummy issuer so the sign-in
// screen shows both options), seeds an account and a conversation through the API, serves the built web UI with
// `next start`, and writes PNGs (desktop 1440x900 and phone 390x844). Playwright is not a dependency of this repo:
// point PLAYWRIGHT at any installed copy (default: resolve "playwright").
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pw = await import(process.env.PLAYWRIGHT ?? "playwright");
const chromium = pw.chromium ?? pw.default.chromium;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, process.argv[2] ?? "docs/screenshots/current");
mkdirSync(out, { recursive: true });
const API_PORT = 18787, WEB_PORT = 13210;
const api = `http://localhost:${API_PORT}`, web = `http://localhost:${WEB_PORT}`;
const data = mkdtempSync(join(tmpdir(), "koremind-shots-"));
const procs = [];
const run = (cmd, args, opts) => { const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "inherit"], ...opts }); procs.push(p); return p; };
const until = async (url) => { for (let i = 0; i < 240; i++) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 250)); } throw new Error(`${url} did not come up`); };

run("bun", ["run", join(root, "backend/src/index.ts")], {
  env: { ...process.env, KOREMIND_FAKE_ENGINE: "1", KOREMIND_DATA_DIR: data, KOREMIND_PORT: String(API_PORT), KOREMIND_OIDC_ISSUER: "https://id.kore.example", KOREMIND_WEB_ORIGINS: web },
});
run("bun", ["run", "start", "-p", String(WEB_PORT)], { cwd: join(root, "web"), env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });

try {
  await until(`${api}/health`);
  await until(`${web}/login`);

  // Seed: the owner, a connected provider, one conversation (markdown + a saved note), a favorite.
  const call = async (method, path, body, token) => {
    const r = await fetch(api + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
    return r;
  };
  const { token } = await (await call("POST", "/auth/register", { email: "anna@example.com", password: "correct horse battery" })).json();
  await call("PUT", "/providers/groq/key", { key: "gsk_fake" }, token);
  await call("PUT", "/favorites", ["groq/llama-fast", "opencode/fast"], token);
  await call("PUT", "/settings", { ...(await (await call("GET", "/settings", undefined, token)).json()), displayName: "Anna", tone: "Short and direct. No filler." }, token);
  const chat = await (await call("POST", "/chats", undefined, token)).json();
  const say = async (text) => { const r = await call("POST", `/chats/${chat.id}/messages`, { text, attachmentIds: [], model: { providerId: "groq", modelId: "llama-fast" } }, token); await r.text(); };
  await say("Plan a **three-day** trip to Lisbon:\n\n1. Day one: Alfama and the castle\n2. Day two: Belém, `pastéis de nata`\n3. Day three: Sintra\n\n> Keep it walkable.");
  await say("note: book the Sintra train");

  const browser = await chromium.launch();
  const shot = async (page, name) => { await page.waitForTimeout(500); await page.mouse.move(0, 0); await page.screenshot({ path: `${out}/${name}.png` }); console.log("wrote", name); };
  const ctx = async (viewport, signedIn) => {
    const c = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce" });
    await c.addInitScript(([u, t]) => { localStorage.setItem("koremind.backendUrl", u); if (t) localStorage.setItem("koremind.token", t); }, [api, signedIn ? token : null]);
    return c.newPage();
  };
  const settle = (p) => p.evaluate(() => document.fonts.ready);

  for (const [prefix, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const out1 = await ctx(viewport, false);
    await out1.goto(`${web}/login`); await settle(out1); await out1.getByText(/Continue with Kore ID/).waitFor();
    await shot(out1, `${prefix}-login`);
    await out1.goto(`${web}/login?e=1#sso_error=not_allowed`); await out1.getByText(/does not accept new accounts/).waitFor();
    await shot(out1, `${prefix}-login-error`);
    await out1.context().close();

    const p = await ctx(viewport, true);
    await p.goto(`${web}/`); await settle(p); await p.getByText("What's on your mind?").waitFor();
    await shot(p, `${prefix}-chat-empty`);
    await p.goto(`${web}/c/${chat.id}`); await p.getByText(/book the Sintra train/).first().waitFor();
    await shot(p, `${prefix}-chat`);
    await p.getByRole("button", { name: /Llama Fast|Choose a model/ }).first().click();
    await p.getByPlaceholder(/Search models/).waitFor();
    await shot(p, `${prefix}-model-picker`);
    await p.keyboard.press("Escape");
    if (prefix === "mobile") {
      await p.getByRole("button", { name: /^(Menu|Open navigation)$/ }).click();
      await shot(p, `${prefix}-drawer`);
      await p.keyboard.press("Escape");
    } else {
      const account = p.getByRole("button", { name: /^Account:/ });
      if (await account.count()) { await account.click(); await shot(p, `${prefix}-account-menu`); await p.keyboard.press("Escape"); }
    }
    for (const s of prefix === "mobile" ? ["providers", "account"] : ["models", "providers", "personalization", "memory", "account"]) {
      await p.goto(`${web}/settings#${s}`); await settle(p); await p.waitForTimeout(400);
      await shot(p, `${prefix}-settings-${s}`);
    }
    await p.context().close();
  }
  await browser.close();
} finally {
  for (const p of procs) p.kill();
  rmSync(data, { recursive: true, force: true });
}
