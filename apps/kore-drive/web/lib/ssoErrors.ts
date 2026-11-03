import type { MessageKey } from "./i18n";

const LOGIN: Record<string, MessageKey> = {
  sso_failed: "login.sso.error.failed",
  sso_denied: "login.sso.error.denied",
  sso_unavailable: "login.sso.error.unavailable",
  sso_email_in_use: "login.sso.error.emailInUse",
  sso_no_email: "login.sso.error.noEmail",
  sso_not_provisioned: "login.sso.error.notProvisioned",
};

const ACCOUNT: Record<string, MessageKey> = {
  linked: "account.sso.linked",
  sso_failed: "login.sso.error.failed",
  sso_denied: "login.sso.error.denied",
  sso_unavailable: "login.sso.error.unavailable",
  sso_sub_taken: "account.sso.error.subTaken",
  sso_already_linked: "account.sso.error.alreadyLinked",
};

/** Message for the `?error=` code the API's SSO callback puts on /login. */
export function loginSsoError(code: string | string[] | undefined): MessageKey | null {
  const c = Array.isArray(code) ? code[0] : code;
  if (!c) return null;
  return Object.hasOwn(LOGIN, c) ? LOGIN[c] : "login.sso.error.failed";
}

/** Message for the `?sso=` result on /account (link flow). */
export function accountSsoMessage(code: string | string[] | undefined): { key: MessageKey; ok: boolean } | null {
  const c = Array.isArray(code) ? code[0] : code;
  if (!c) return null;
  return { key: Object.hasOwn(ACCOUNT, c) ? ACCOUNT[c] : "login.sso.error.failed", ok: c === "linked" };
}
