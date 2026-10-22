/**
 * Public share links: API types, the share-scoped URLs the public page and
 * its preview use, and pure display helpers.
 */
import { isApiError } from "./api";
import { t, type MessageKey } from "./i18n";
import type { PreviewUrls } from "./preview";

export type ShareStatus = "active" | "expired" | "revoked" | "item_trashed" | "unavailable";

/** An owner's link as returned by `/api/shares`. */
export type Share = {
  id: string;
  token: string;
  url_path: string;
  node_id: string;
  node_name: string;
  is_dir: boolean;
  size: number;
  created_at: number;
  expires_at: number | null;
  has_password: boolean;
  download_count: number;
  last_accessed_at: number | null;
  status: ShareStatus;
};

/** What `GET /api/me/settings` says about links. */
export type ShareSettings = { share_links_enabled: boolean; share_default_expiry_days: number };

/** Expiry choices offered when creating or editing a link ("never" = null). */
export type ExpiryChoice = "1" | "7" | "30" | "never";
export const EXPIRY_CHOICES: readonly ExpiryChoice[] = ["1", "7", "30", "never"];

export function expiryLabel(c: ExpiryChoice): string {
  switch (c) {
    case "1":
      return t("share.expiry.1");
    case "7":
      return t("share.expiry.7");
    case "30":
      return t("share.expiry.30");
    default:
      return t("share.expiry.never");
  }
}

/** The choice preselected for a server default (0 = never; others snap to 7). */
export function defaultChoice(days: number): ExpiryChoice {
  if (days === 0) return "never";
  return days === 1 || days === 30 ? (String(days) as ExpiryChoice) : "7";
}

/** `expires_in_days` for the API. */
export function expiryDays(c: ExpiryChoice): number | null {
  return c === "never" ? null : Number(c);
}

/** Public metadata from `GET /api/public/shares/{token}`. */
export type PublicMeta = {
  name?: string;
  is_dir?: boolean;
  size?: number;
  mime?: string;
  expires_at: number | null;
  has_password: boolean;
  unlocked: boolean;
  status: string;
};

export type PublicNode = { id: string; name: string; is_dir: boolean; size: number; mime: string; updated_at: number };
export type PublicListing = {
  folder: PublicNode;
  breadcrumb: { id: string; name: string }[];
  children: PublicNode[];
};

/** Base path of a share's public API. */
export function publicBase(token: string): string {
  return `/api/public/shares/${encodeURIComponent(token)}`;
}

function withNode(path: string, param: string, id: string): string {
  return id ? `${path}?${param}=${encodeURIComponent(id)}` : path;
}

/** Share-scoped endpoints; an empty id means the shared item itself. */
export function shareUrls(token: string): PreviewUrls & {
  download: (id: string) => string;
  zip: (id: string) => string;
  children: (folder: string) => string;
  unlock: string;
} {
  const base = publicBase(token);
  return {
    text: (id) => withNode(`${base}/preview`, "node", id),
    view: (id) => withNode(`${base}/view`, "node", id),
    download: (id) => withNode(`${base}/download`, "node", id),
    zip: (id) => withNode(`${base}/zip`, "node", id),
    children: (folder) => withNode(`${base}/children`, "folder", folder),
    unlock: `${base}/unlock`,
  };
}

/** The public page of a share, with an optional folder inside it. */
export function sharePageHref(token: string, folder?: string): string {
  const p = `/s/${encodeURIComponent(token)}`;
  return folder ? `${p}?folder=${encodeURIComponent(folder)}` : p;
}

/** Absolute link to give out (browser only: uses the page's origin). */
export function shareUrl(origin: string, token: string): string {
  return origin.replace(/\/+$/, "") + sharePageHref(token);
}

/** Current Unix time in seconds. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

const DAY = 86400;
const HOUR = 3600;

/** "Expires in 3 days" / "Expires in 5 hours" / "Never expires" / "Expired". */
export function expiryText(expiresAt: number | null, nowSeconds: number): string {
  if (expiresAt === null) return t("share.neverExpires");
  const left = expiresAt - nowSeconds;
  if (left <= 0) return t("share.expired");
  if (left >= 2 * DAY) return t("share.expiresInDays", { count: Math.round(left / DAY) });
  if (left >= DAY) return t("share.expiresInOneDay");
  if (left >= 2 * HOUR) return t("share.expiresInHours", { count: Math.round(left / HOUR) });
  return t("share.expiresSoon");
}

export function statusLabel(s: ShareStatus): string {
  const keys: Record<ShareStatus, MessageKey> = {
    active: "share.status.active",
    expired: "share.status.expired",
    revoked: "share.status.revoked",
    item_trashed: "share.status.item_trashed",
    unavailable: "share.status.unavailable",
  };
  return t(keys[s] ?? "share.status.unavailable");
}

/** The state a public page shows for an API error. */
export type PublicProblem = "gone" | "expired" | "revoked" | "disabled" | "rateLimited" | "error";

export function publicProblem(e: unknown): PublicProblem {
  if (!isApiError(e)) return "error";
  if (e.status === 404 || (e.status === 410 && e.code === "unavailable")) return "gone";
  if (e.status === 410 && e.code === "expired") return "expired";
  if (e.status === 410 && e.code === "revoked") return "revoked";
  if (e.status === 403 && e.code === "shares_disabled") return "disabled";
  if (e.status === 429) return "rateLimited";
  return "error";
}

/** Message for an owner-side share API error. */
export function shareErrorKey(e: unknown): MessageKey {
  if (isApiError(e)) {
    switch (e.code) {
      case "shares_disabled":
        return "share.error.disabled";
      case "password_too_short":
        return "share.error.passwordShort";
      case "password_too_long":
        return "share.error.passwordLong";
      case "not_found":
        return "share.error.notFound";
      case "busy":
        return "share.error.busy";
    }
  }
  return "share.error.generic";
}

/** Message for a failed unlock. */
export function unlockErrorKey(e: unknown): MessageKey {
  if (isApiError(e, 403) && e.code === "wrong_password") return "publicShare.wrongPassword";
  if (isApiError(e, 429)) return "publicShare.tooManyAttempts";
  if (isApiError(e, 503)) return "share.error.busy";
  return "share.error.generic";
}

/** Cookie names the public page forwards to the API (unlock cookies only). */
export const SHARE_COOKIE_PREFIX = "kore_share_";

/** Builds a Cookie header from only the share unlock cookies. */
export function shareCookieHeader(cookies: readonly { name: string; value: string }[]): string {
  return cookies
    .filter((c) => c.name.startsWith(SHARE_COOKIE_PREFIX) && /^[A-Za-z0-9_]+$/.test(c.name) && /^[0-9a-f.]+$/.test(c.value))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}
