import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
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
 */
export async function requireUser(): Promise<User> {
  try {
    return await api<User>("/api/auth/me");
  } catch (e) {
    if (isApiError(e, 401)) {
      const path = (await headers()).get(PATH_HEADER) ?? DEFAULT_LANDING;
      redirect(loginUrl(path, true));
    }
    throw e;
  }
}
