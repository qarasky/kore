import "server-only";

import { cache } from "react";
import { api } from "./api";

/** How this instance lets people in (`GET /api/auth/config`). With Kore ID on,
 *  `issuer` is its base URL and `apps` the Kore apps' URLs for the switcher. */
export type AuthConfig = {
  /** Kore ID and an owner email are configured: the first Kore ID sign-in with
   *  that verified email becomes the administrator on a fresh install. */
  first_user_sso: boolean;
  oidc: boolean;
  issuer?: string;
  apps?: Partial<Record<"kore" | "koremind" | "korecalendar" | "flatline", string>>;
};

const FALLBACK: AuthConfig = { first_user_sso: false, oidc: false };

/**
 * Cached per request. Any failure falls back to "Kore ID is not configured",
 * which still renders when this lookup does not work (API down).
 */
export const getAuthConfig = cache(async (): Promise<AuthConfig> => {
  try {
    return await api<AuthConfig>("/api/auth/config", { signal: AbortSignal.timeout(3000) });
  } catch {
    return FALLBACK;
  }
});
