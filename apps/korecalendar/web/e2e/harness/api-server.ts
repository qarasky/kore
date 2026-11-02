import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { API_DIR, API_PORT, API_URL, BINARY, CONFIG_FILE, DATA_DIR, WORK_DIR } from "./env";
import { httpOk, run, startProcess, stopProcess, waitFor, waitGone } from "./proc";

const HEALTH = `${API_URL}/api/healthz`;

/** Build the Go binary into the e2e work directory. */
export function buildApi(): void {
  mkdirSync(WORK_DIR, { recursive: true });
  run("go", ["build", "-o", BINARY, "./cmd/korecalendar"], { cwd: API_DIR });
}

function writeConfig(): void {
  writeFileSync(CONFIG_FILE, `data_dir = "${DATA_DIR}"\nbind = "127.0.0.1"\nport = ${API_PORT}\n`);
}

/** Start the API on the existing data directory. */
export async function startApi(): Promise<void> {
  writeConfig();
  startProcess("api", BINARY, ["-config", CONFIG_FILE], {});
  await waitFor("the API", () => httpOk(HEALTH));
}

export async function stopApi(): Promise<void> {
  stopProcess("api");
  await waitGone(HEALTH);
}

/** Stop the API, wipe its data, initialise a fresh data directory and start it: a clean slate. */
export async function resetApi(): Promise<void> {
  await stopApi();
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  writeConfig();
  run(BINARY, ["init", "-config", CONFIG_FILE]);
  await startApi();
}
