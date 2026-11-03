import { expect, request, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { DEFAULT_QUOTA, ensureUser, sessionToken } from "./harness/db";
import { E2E } from "./harness/env";

export const ADMIN = E2E.admin;

/** kore-ui's toast region (Radix): the toasts on screen. */
export const toasts = (page: Page): Locator => page.getByRole("region", { name: /^Notifications/ });
export const DEFAULT_PASSWORD = "user-password-123";

/**
 * Signs `page`'s browser context in. Kore ID is the only login path and the
 * harness runs no provider, so this seeds a session in the API's database and
 * sets the cookie the SSO callback would have set. The password argument is
 * accepted for old call sites and ignored.
 */
export async function loginAs(page: Page, email: string, password?: string): Promise<void> {
  void password; // old call sites still pass one; there is no password login
  const value = sessionToken(email);
  await page.context().addCookies([{ name: "kore_session", value, url: E2E.webUrl }]);
}

/** A standalone API client signed in as the given user (talks to the API directly). */
export async function apiAs(email: string, password?: string): Promise<APIRequestContext> {
  void password; // old call sites still pass one; there is no password login
  const value = sessionToken(email);
  return request.newContext({
    baseURL: E2E.apiUrl,
    extraHTTPHeaders: { Cookie: `kore_session=${value}` },
  });
}

export type CreatedUser = {
  id: string;
  email: string;
  password: string;
  role: "admin" | "user";
  quota_bytes: number;
};

let seq = 0;

/**
 * Creates an account. Accounts come from Kore ID now, so this inserts the row
 * directly; the returned password is only there for old call sites.
 */
export async function createUser(
  opts: { email?: string; password?: string; role?: "admin" | "user"; quota_bytes?: number } = {},
): Promise<CreatedUser> {
  const email = opts.email ?? `user-${Date.now()}-${++seq}@kore.test`;
  const u = ensureUser(email, opts.role ?? "user", opts.quota_bytes ?? DEFAULT_QUOTA);
  return { ...u, role: u.role as "admin" | "user", password: opts.password ?? DEFAULT_PASSWORD };
}

/** Creates a folder in the user's personal space (or `parent_id`) and returns its id. */
export async function createFolder(
  api: APIRequestContext,
  name: string,
  opts: { space?: "personal" | "shared"; parent_id?: string } = {},
): Promise<string> {
  const res = await api.post("/api/nodes", {
    data: { space: opts.space ?? "personal", parent_id: opts.parent_id, name },
  });
  expect(res.status(), `create folder ${name}`).toBe(201);
  return (await res.json()).id;
}

/** Uploads a small file in one chunk (personal root or `parent`); returns the node id. */
export async function uploadFile(
  api: APIRequestContext,
  name: string,
  content: string | Buffer,
  opts: { space?: "personal" | "shared"; parent?: string } = {},
): Promise<string> {
  const data = typeof content === "string" ? Buffer.from(content) : content;
  const created = await api.post("/api/uploads", {
    data: {
      space: opts.space ?? "personal",
      parent: opts.parent ?? null,
      name,
      size: data.length,
      chunk_size: Math.max(1 << 20, data.length),
    },
  });
  expect(created.status(), `create upload ${name}`).toBe(201);
  const { id } = await created.json();
  if (data.length > 0) {
    const chunk = await api.patch(`/api/uploads/${id}`, {
      data,
      headers: { "Upload-Offset": "0", "Content-Type": "application/offset+octet-stream" },
    });
    expect(chunk.status(), `upload chunk ${name}`).toBeLessThan(300);
  }
  const done = await api.post(`/api/uploads/${id}/complete`);
  expect(done.ok(), `complete upload ${name}`).toBe(true);
  return (await done.json()).id;
}

/**
 * Picks `option` in the custom `Select` (components/Select.tsx) named
 * `label` within `scope` (a page, or e.g. a dialog/form locator): opens it
 * with a click and clicks the option, then checks the trigger shows it.
 */
export async function chooseOption(scope: Page | Locator, label: string, option: string): Promise<void> {
  const page = "page" in scope && typeof scope.page === "function" ? scope.page() : (scope as Page);
  const combo = scope.getByRole("combobox", { name: label, exact: true });
  await combo.click();
  await page.getByRole("listbox").getByRole("option", { name: option, exact: true }).click();
  await expect(combo).toHaveAttribute("aria-expanded", "false");
  await expect(combo).toHaveText(option);
}
