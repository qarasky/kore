import { defineConfig, devices } from "@playwright/test";
import { E2E } from "./e2e/harness/env";

/**
 * E2E against the real stack: a freshly built Go API with an empty data dir
 * (e2e/harness/api-server.ts) and the production standalone Next server
 * (e2e/harness/web-server.ts). Servers are never reused, so every run starts
 * from a wiped data dir.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // One worker: tests share one API instance and its login rate limiter.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: E2E.webUrl,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      name: "api",
      command: "node e2e/harness/api-server.ts",
      url: `${E2E.apiUrl}/api/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      stdout: "pipe",
    },
    {
      name: "web",
      command: "node e2e/harness/web-server.ts",
      url: `${E2E.webUrl}/login`,
      reuseExistingServer: false,
      timeout: 180_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      stdout: "pipe",
    },
  ],
});
