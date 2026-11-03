import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { API_DIR, API_PORT, API_URL, BASE_URL, BINARY, CONFIG_FILE, DATA_DIR, EXTERNAL, WORK_DIR } from "./env";
import { httpOk, run, startProcess, stopProcess, waitFor, waitGone } from "./proc";

const HEALTH = `${API_URL}/api/healthz`;

/** Build the Go binary into the e2e work directory. */
export function buildApi(): void {
  mkdirSync(WORK_DIR, { recursive: true });
  run("go", ["build", "-o", BINARY, "./cmd/korecalendar"], { cwd: API_DIR });
}

function writeConfig(): void {
  let cfg = `data_dir = "${DATA_DIR}"\nbind = "127.0.0.1"\nport = ${API_PORT}\n`;
  // E2E_OIDC=1 turns on "Continue with Kore ID" (the provider is never contacted unless it is clicked;
  // discovery is lazy), for specs and screenshots of the sign-in screen with SSO.
  if (process.env.E2E_OIDC === "1") {
    cfg += `public_url = "${BASE_URL}"\n[oidc]\nissuer = "http://127.0.0.1:9"\nclient_id = "korecalendar"\napps = { kore = "https://files.example.com/", koremind = "https://mind.example.com/", flatline = "https://status.example.com/" }\n`;
  }
  writeFileSync(CONFIG_FILE, cfg);
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
  if (EXTERNAL) {
    const cmd = process.env.E2E_RESET_CMD;
    if (!cmd) throw new Error("E2E_BASE_URL is set, so E2E_RESET_CMD (a command that empties the API's data) is required");
    run("bash", ["-c", cmd]);
    await waitFor("the API after the reset", () => httpOk(HEALTH));
    return;
  }
  await stopApi();
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  writeConfig();
  run(BINARY, ["init", "-config", CONFIG_FILE]);
  await startApi();
}
