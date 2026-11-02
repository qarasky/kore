import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Everything the e2e harness needs to agree on: ports, paths, the seeded account. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const WEB_DIR = join(ROOT, "web");
export const API_DIR = join(ROOT, "api");

export const API_PORT = 18180;
export const WEB_PORT = 13100;
/** A second web instance whose API is never started, for the API-down specs. */
export const DEAD_WEB_PORT = 13101;
export const DEAD_API_PORT = 19199;

/**
 * `E2E_BASE_URL` points the suite at a stack that is already running (for example the Docker
 * install behind Caddy) instead of building and starting one. The API is then reached through
 * the same address (`/api/...`), and `E2E_RESET_CMD` is a shell command that leaves that stack
 * with a fresh, empty API (the specs call it between files).
 */
export const EXTERNAL = Boolean(process.env.E2E_BASE_URL);

export const BASE_URL = (process.env.E2E_BASE_URL ?? `http://127.0.0.1:${WEB_PORT}`).replace(/\/+$/, "");
export const API_URL = EXTERNAL ? BASE_URL : `http://127.0.0.1:${API_PORT}`;
export const DEAD_WEB_URL = `http://127.0.0.1:${DEAD_WEB_PORT}`;

export const WORK_DIR = join(tmpdir(), "korecal-e2e");
export const BINARY = join(WORK_DIR, "korecalendar");
export const DATA_DIR = join(WORK_DIR, "data");
export const CONFIG_FILE = join(WORK_DIR, "korecal.toml");
export const PID_DIR = join(WORK_DIR, "pids");

export const OWNER = { email: "owner@korecal.test", password: "owner-password-123" };

export const FIXTURES = join(API_DIR, "internal/ics/testdata");
