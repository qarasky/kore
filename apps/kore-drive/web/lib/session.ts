import "server-only";

import { headers } from "next/headers";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { api, isApiError } from "./api";
import { loginUrl, PATH_HEADER } from "./routes";
import { DEFAULT_LANDING } from "./safe-next";

export type Role = "admin" | "user";

export type User = {
  id: string;
  email: string;
  role: Role;
  quota_bytes: number;
};

/**
 * Validates the session against the API (`GET /api/auth/me`). The proxy only
 * checks that a cookie exists; this is the real check. On 401 it redirects to
 * the login page, returning to the current path afterwards.
 *
 * Cached per request, so the app layout and its page share one lookup.
 */
export const requireUser = cache(async (): Promise<User> => {
  try {
    return await api<User>("/api/auth/me");
  } catch (e) {
    if (isApiError(e, 401)) {
      const path = (await headers()).get(PATH_HEADER) ?? DEFAULT_LANDING;
      redirect(loginUrl(path, true));
    }
    throw e;
  }
});

/**
 * Like {@link requireUser}, for admin pages: anyone who is not an admin gets
 * the 404 page (the admin area does not reveal that it exists). The API
 * enforces the same rule with 403 on every `/api/admin/*` route.
 */
export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") notFound();
  return user;
}
