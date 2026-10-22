import { isApiError } from "./api";
import type { MessageKey } from "./i18n";

/** `GET /api/branding` (public). */
export type Branding = { login_image: boolean; version: number };

/** Mirrors the API's cap on the login picture (`maxLoginImageBytes`). */
export const MAX_LOGIN_IMAGE_BYTES = 5 * 1024 * 1024;
/** The types the API accepts (it checks the magic bytes, not this). */
export const LOGIN_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** The custom login picture's URL, or null for the built-in artwork. The
 *  version busts the browser cache after an upload or reset. */
export function loginImageSrc(b: Branding | null): string | null {
  if (!b?.login_image) return null;
  const v = Number.isFinite(b.version) ? Math.trunc(b.version) : 0;
  return `/api/branding/login-image?v=${v}`;
}

/** Client-side check before uploading; the server validates again. */
export function checkLoginImageFile(f: { type: string; size: number }): MessageKey | null {
  if (!(LOGIN_IMAGE_TYPES as readonly string[]).includes(f.type) || f.size === 0) return "branding.error.type";
  if (f.size > MAX_LOGIN_IMAGE_BYTES) return "branding.error.tooLarge";
  return null;
}

export function loginImageError(e: unknown): MessageKey {
  if (isApiError(e, 415)) return "branding.error.type";
  if (isApiError(e, 413)) return "branding.error.tooLarge";
  return "branding.error.generic";
}
