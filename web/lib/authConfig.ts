import "server-only";

import { cache } from "react";
import { api } from "./api";

/** How this instance lets people in (`GET /api/auth/config`). With Kore ID on,
 *  `issuer` is its base URL and `apps` the Kore apps' URLs for the switcher. */
export type AuthConfig = {
  local_login: boolean;
  oidc: boolean;
  issuer?: string;
  apps?: Partial<Record<"kore" | "koremind" | "korecalendar" | "flatline", string>>;
};

const FALLBACK: AuthConfig = { local_login: true, oidc: false };

/**
 * Cached per request. Any failure falls back to the password form: it has to
 * render even when this lookup does not work (older API, API down).
 */
export const getAuthConfig = cache(async (): Promise<AuthConfig> => {
  try {
    return await api<AuthConfig>("/api/auth/config", { signal: AbortSignal.timeout(3000) });
  } catch {
    return FALLBACK;
  }
});
