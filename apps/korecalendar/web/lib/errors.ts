import { isApiError } from "./api";
import { t, type MessageKey } from "./i18n";
import en from "./i18n/en";

/** A person-readable message for any error thrown by an API call. */
export function errorMessage(e: unknown): string {
  if (!isApiError(e)) return t("error.generic");
  if (e.code === "unreachable") return t("error.unreachable");
  if (e.code === "rate_limited") {
    return t("error.rate_limited", { minutes: Math.max(1, Math.ceil((e.retryAfterSec ?? 60) / 60)) });
  }
  const key = `error.${e.code}`;
  return key in en ? t(key as MessageKey) : t("error.generic");
}
