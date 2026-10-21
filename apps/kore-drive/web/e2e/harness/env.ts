/** Fixed endpoints and credentials of the e2e stack (see playwright.config.ts). */
export const E2E = {
  apiPort: 18080,
  webPort: 13000,
  apiUrl: "http://127.0.0.1:18080",
  webUrl: "http://127.0.0.1:13000",
  admin: { email: "admin@kore.test", password: "admin-password-123" },
} as const;
