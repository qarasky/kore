/** Types and error mapping for the admin API (`/api/admin/*`). */
import { isApiError } from "./api";
import type { MessageKey } from "./i18n";
import type { Role } from "./session";

export type AdminUser = {
  id: string;
  email: string;
  role: Role;
  quota_bytes: number;
  used_bytes: number;
  /** Unix seconds. */
  created_at: number;
};

export type UsageRow = {
  user_id: string;
  email: string;
  used_bytes: number;
  quota_bytes: number;
};

export type AdminSettings = {
  trash_retention_days: number;
  /** 0 = unlimited. */
  max_file_bytes: number;
  default_quota_bytes: number;
  share_links_enabled: boolean;
  /** 0 = links never expire by default. */
  share_default_expiry_days: number;
};

/** Server range for `trash_retention_days`. */
export const RETENTION_MIN_DAYS = 1;
export const RETENTION_MAX_DAYS = 3650;

/** Parses the retention field: a whole number of days in range, else null. */
export function parseRetentionDays(input: string): number | null {
  const s = input.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= RETENTION_MIN_DAYS && n <= RETENTION_MAX_DAYS ? n : null;
}

/** Body of the 409 `user_has_files` reply to `DELETE /api/admin/users/{id}`. */
export type UserHasFiles = {
  /** Items in the user's personal space (folders and trash included). */
  personal_count: number;
  /** Items they uploaded to the shared space (kept, handed to the admin). */
  shared_count: number;
  /** Items they uploaded that now sit in other users' personal spaces
   *  (kept, charged to those users). */
  other_count: number;
};

const ERRORS: Record<string, MessageKey> = {
  invalid_email: "admin.error.invalidEmail",
  email_in_use: "admin.error.emailInUse",
  password_too_short: "admin.error.passwordTooShort",
  password_too_long: "admin.error.passwordTooLong",
  invalid_role: "admin.error.invalidRole",
  invalid_quota: "admin.error.invalidQuota",
  last_admin: "admin.error.lastAdmin",
  cannot_delete_self: "admin.error.cannotDeleteSelf",
  not_found: "admin.error.userNotFound",
  wrong_password: "account.error.wrongPassword",
  too_many_attempts: "account.error.rateLimited",
  busy: "admin.error.busy",
  invalid_trash_retention_days: "settings.error.retention",
  invalid_max_file_bytes: "settings.error.maxFileSize",
  invalid_default_quota_bytes: "settings.error.defaultQuota",
  forbidden: "admin.error.forbidden",
  unauthorized: "admin.error.signedOut",
};

/** A plain-language message for an admin/account API failure. */
export function adminErrorKey(e: unknown): MessageKey {
  if (isApiError(e)) {
    const key = ERRORS[e.code];
    if (key) return key;
    if ([502, 503, 504].includes(e.status)) return "admin.error.unreachable";
  }
  return "admin.error.generic";
}
