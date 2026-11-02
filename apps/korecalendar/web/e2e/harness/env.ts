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

export const API_URL = `http://127.0.0.1:${API_PORT}`;
export const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;
export const DEAD_WEB_URL = `http://127.0.0.1:${DEAD_WEB_PORT}`;

export const WORK_DIR = join(tmpdir(), "korecal-e2e");
export const BINARY = join(WORK_DIR, "korecalendar");
export const DATA_DIR = join(WORK_DIR, "data");
export const CONFIG_FILE = join(WORK_DIR, "korecal.toml");
export const PID_DIR = join(WORK_DIR, "pids");

export const OWNER = { email: "owner@korecal.test", password: "owner-password-123" };

export const FIXTURES = join(API_DIR, "internal/ics/testdata");
