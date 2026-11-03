import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Endpoints and credentials of the e2e stack (see playwright.config.ts).
 *
 * By default Playwright starts its own API (127.0.0.1:18080) and web server
 * (127.0.0.1:13000). Set E2E_BASE_URL (e.g. http://localhost:8080) to run
 * against an already running deployment instead, such as the Docker Compose
 * stack behind Caddy, which serves the UI and /api on one origin; then
 * E2E_ADMIN_EMAIL names its admin account. Tests that need the extra
 * API-down web instance are skipped in that mode.
 */
const baseUrl = process.env.E2E_BASE_URL?.replace(/\/+$/, "") || undefined;
// E2E_PORT_BASE (e.g. 28000) moves the local stack off the default ports when
// something else already listens there: API base+80, web base+5000/+5001.
const portBase = Number(process.env.E2E_PORT_BASE) || 0;
const apiPort = portBase ? portBase + 80 : 18080;
const webPort = portBase ? portBase + 5000 : 13000;

export const E2E = {
  /** True when targeting an external deployment (E2E_BASE_URL). */
  external: baseUrl !== undefined,
  apiPort,
  webPort,
  apiUrl: baseUrl ?? `http://127.0.0.1:${apiPort}`,
  webUrl: baseUrl ?? `http://127.0.0.1:${webPort}`,
  /** A second web instance whose API_URL points at a closed port, to test
   *  how SSR behaves when the API is down. Same host, so cookies carry over.
   *  Not available with E2E_BASE_URL. */
  webDownPort: webPort + 1,
  webDownUrl: `http://127.0.0.1:${webPort + 1}`,
  deadApiUrl: "http://127.0.0.1:1",
  /** SQLite file of the local API (see api-server.ts); null externally. */
  dbPath: baseUrl ? null : path.join(tmpdir(), `kore-e2e-${apiPort}`, "data", "kore.db"),
  admin: {
    email: process.env.E2E_ADMIN_EMAIL || "admin@kore.test",
    /** Unused now that Kore ID is the only sign-in; old call sites pass it. */
    password: process.env.E2E_ADMIN_PASSWORD || "admin-password-123",
  },
} as const;
