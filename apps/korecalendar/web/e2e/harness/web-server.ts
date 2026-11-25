import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { API_URL, BASE_URL, DEAD_API_PORT, DEAD_WEB_PORT, DEAD_WEB_URL, WEB_DIR, WEB_PORT } from "./env";
import { httpOk, run, startProcess, stopProcess, waitFor, waitGone } from "./proc";

// Next traces the standalone output from the monorepo root (next.config.ts), so the app sits at
// .next/standalone/apps/korecalendar/web/ inside it.
const STANDALONE = join(WEB_DIR, ".next/standalone");
const APP_DIR = join(STANDALONE, relative(resolve(WEB_DIR, "../../.."), WEB_DIR));
const SERVER = join(APP_DIR, "server.js");

/** Build the production standalone bundle against the e2e API (rewrites are baked in at build time). */
export function buildWeb(): void {
  run("bun", ["run", "build"], { cwd: WEB_DIR, env: { API_URL } });
  // `output: "standalone"` does not copy static assets or public/.
  run("rm", ["-rf", join(APP_DIR, "public"), join(APP_DIR, ".next/static")]);
  run("cp", ["-r", join(WEB_DIR, "public"), join(APP_DIR, "public")]);
  run("cp", ["-r", join(WEB_DIR, ".next/static"), join(APP_DIR, ".next/static")]);
}

export function hasBuild(): boolean {
  return existsSync(SERVER);
}

async function start(name: string, port: number, url: string, apiUrl: string): Promise<void> {
  startProcess(name, "node", [SERVER], { cwd: APP_DIR, env: { PORT: String(port), HOSTNAME: "127.0.0.1", API_URL: apiUrl } });
  await waitFor(`the ${name} server`, () => httpOk(`${url}/sw.js`));
}

export const startWeb = () => start("web", WEB_PORT, BASE_URL, API_URL);

/** A web server whose API (DEAD_API_PORT) is never running. */
export const startDeadWeb = () => start("web-dead", DEAD_WEB_PORT, DEAD_WEB_URL, `http://127.0.0.1:${DEAD_API_PORT}`);

export async function stopDeadWeb(): Promise<void> {
  stopProcess("web-dead");
  await waitGone(`${DEAD_WEB_URL}/sw.js`);
}

export function stopWeb(): void {
  stopProcess("web");
}
