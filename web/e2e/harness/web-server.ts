/**
 * Builds the web app and serves the production standalone server
 * (`.next/standalone/server.js`, the artifact we ship) on 127.0.0.1:13000,
 * talking to the e2e API at 127.0.0.1:18080.
 *
 * API_URL is needed at build time (the /api rewrite in next.config.ts is
 * baked into the build) and at runtime (server-side api() calls).
 * Set E2E_SKIP_BUILD=1 to reuse an existing e2e build.
 *
 * Run with `node e2e/harness/web-server.ts`.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { E2E } from "./env.ts";
import { serve } from "./proc.ts";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const standalone = path.join(webDir, ".next/standalone");
const env = { ...process.env, API_URL: E2E.apiUrl, NEXT_TELEMETRY_DISABLED: "1" };

if (!process.env.E2E_SKIP_BUILD) {
  console.log("[e2e web] next build");
  execFileSync(process.execPath, [path.join(webDir, "node_modules/next/dist/bin/next"), "build"], {
    cwd: webDir,
    env,
    stdio: "inherit",
  });
}

// The standalone server does not include static assets; copy them in.
const staticDest = path.join(standalone, ".next/static");
rmSync(staticDest, { recursive: true, force: true });
cpSync(path.join(webDir, ".next/static"), staticDest, { recursive: true });
if (existsSync(path.join(webDir, "public"))) {
  cpSync(path.join(webDir, "public"), path.join(standalone, "public"), { recursive: true });
}

console.log(`[e2e web] starting on ${E2E.webUrl}`);
serve(process.execPath, [path.join(standalone, "server.js")], {
  ...env,
  NODE_ENV: "production",
  PORT: String(E2E.webPort),
  HOSTNAME: "127.0.0.1",
});
