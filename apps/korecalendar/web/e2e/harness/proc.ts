import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PID_DIR, WORK_DIR } from "./env";

/** Poll `fn` until it is truthy or `ms` pass. */
export async function waitFor(what: string, fn: () => Promise<boolean>, ms = 30_000): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      if (await fn()) return;
    } catch {
      // not up yet
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function httpOk(url: string): Promise<boolean> {
  const res = await fetch(url, { redirect: "manual" });
  return res.status < 500;
}

function pidFile(name: string): string {
  mkdirSync(PID_DIR, { recursive: true });
  return join(PID_DIR, `${name}.pid`);
}

/**
 * Start a long-lived child that outlives the Playwright worker that started it
 * (workers restart after a failure); `stopProcess` and the global teardown kill
 * it through the pid file.
 */
export function startProcess(name: string, cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> }): void {
  stopProcess(name);
  mkdirSync(WORK_DIR, { recursive: true });
  const log = openSync(join(WORK_DIR, `${name}.log`), "w");
  const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, detached: true, stdio: ["ignore", log, log] });
  closeSync(log);
  if (!child.pid) throw new Error(`could not start ${name}`);
  writeFileSync(pidFile(name), String(child.pid));
  child.unref();
}

export function isRunning(name: string): boolean {
  const file = pidFile(name);
  if (!existsSync(file)) return false;
  try {
    process.kill(Number(readFileSync(file, "utf8")), 0);
    return true;
  } catch {
    return false;
  }
}

export function stopProcess(name: string): void {
  const file = pidFile(name);
  if (!existsSync(file)) return;
  const pid = Number(readFileSync(file, "utf8"));
  rmSync(file, { force: true });
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already gone
  }
}

/** Wait until a stopped child has really exited, so its port is free again. */
export async function waitGone(url: string): Promise<void> {
  await waitFor(`${url} to stop answering`, async () => {
    try {
      await fetch(url);
      return false;
    } catch {
      return true;
    }
  });
}

/** Run a command to completion, failing loudly with its output. */
export function run(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): void {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})\n${r.stdout}\n${r.stderr}`);
}
