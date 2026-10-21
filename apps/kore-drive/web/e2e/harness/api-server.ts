/**
 * Starts a throwaway Kore API for e2e tests:
 *   1. `go build` the binary once per run into a temp dir,
 *   2. create a fresh data dir (wiped at start and on exit) and kore.toml,
 *   3. `kore init`, then run the API on 127.0.0.1:18080 in the foreground.
 *
 * Run with `node e2e/harness/api-server.ts` (Node strips the types).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { E2E } from "./env.ts";
import { serve } from "./proc.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, "../../../api");
const root = path.join(tmpdir(), "kore-e2e");
const bin = path.join(root, "kore");
const dataDir = path.join(root, "data");
const config = path.join(root, "kore.toml");

const wipe = () => rmSync(root, { recursive: true, force: true });

wipe();
mkdirSync(dataDir, { recursive: true });

console.log(`[e2e api] building ${apiDir} -> ${bin}`);
execFileSync("go", ["build", "-o", bin, "./cmd/kore"], { cwd: apiDir, stdio: "inherit" });

writeFileSync(
  config,
  [
    `port = ${E2E.apiPort}`,
    `bind = "127.0.0.1"`,
    `data_dir = ${JSON.stringify(dataDir)}`,
    `admin_email = ${JSON.stringify(E2E.admin.email)}`,
    `admin_password = ${JSON.stringify(E2E.admin.password)}`,
    "",
  ].join("\n"),
);

execFileSync(bin, ["init", "-config", config], { stdio: "inherit" });

console.log(`[e2e api] starting on ${E2E.apiUrl} (data: ${dataDir})`);
serve([{ cmd: bin, args: ["-config", config], env: process.env }], wipe);
