import { expect, request, type APIRequestContext, type Page } from "@playwright/test";
import { E2E } from "./harness/env";

export const ADMIN = E2E.admin;
export const DEFAULT_PASSWORD = "user-password-123";

/** Logs `page`'s browser context in through the API (sets kore_session). */
export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  const res = await page.request.post("/api/auth/login", { data: { email, password } });
  expect(res.status(), `login as ${email}`).toBe(200);
}

/** A standalone API client logged in as the given user (talks to the API directly). */
export async function apiAs(email: string, password: string): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL: E2E.apiUrl });
  const res = await ctx.post("/api/auth/login", { data: { email, password } });
  expect(res.status(), `api login as ${email}`).toBe(200);
  return ctx;
}

export type CreatedUser = {
  id: string;
  email: string;
  password: string;
  role: "admin" | "user";
  quota_bytes: number;
};

let seq = 0;

/** Creates a user through the admin API. Email defaults to a unique address. */
export async function createUser(
  opts: { email?: string; password?: string; role?: "admin" | "user"; quota_bytes?: number } = {},
): Promise<CreatedUser> {
  const email = opts.email ?? `user-${Date.now()}-${++seq}@kore.test`;
  const password = opts.password ?? DEFAULT_PASSWORD;
  const admin = await apiAs(ADMIN.email, ADMIN.password);
  try {
    const res = await admin.post("/api/admin/users", {
      data: { email, password, role: opts.role ?? "user", quota_bytes: opts.quota_bytes },
    });
    expect(res.status(), `create user ${email}`).toBe(201);
    return { ...(await res.json()), password };
  } finally {
    await admin.dispose();
  }
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
