/**
 * English UI strings. Every piece of user-visible copy lives here; components
 * call `t("key")` instead of using string literals.
 *
 * Keys are flat, dot-namespaced by area. `{name}` placeholders are filled by
 * `t(key, { name })`. Another locale (e.g. `ru.ts`) must provide exactly the
 * same keys: type it as `Messages` from `./index`.
 */
const en = {
  "app.name": "Kore",
  "app.description": "Files for the office",
  "app.titleTemplate": "%s · Kore",

  "login.title": "Sign in",
  "login.subtitle": "Use the account your admin created for you.",
  "login.email": "Email",
  "login.password": "Password",
  "login.submit": "Sign in",
  "login.submitting": "Signing in…",
  "login.error.invalid": "Wrong email or password.",
  "login.error.rateLimited": "Too many attempts. Try again in a few minutes.",
  "login.error.generic": "Could not sign in. Please try again.",
  "login.error.unreachable": "The file server is not responding. Try again in a moment.",
  "login.expired": "Your session has ended. Please sign in again.",

  "error.title": "Something went wrong",
  "error.description": "This page could not be loaded. Try again; if it keeps happening, tell your administrator.",
  "error.unreachableTitle": "Can't reach the file server",
  "error.unreachable": "The file server is not responding. It may be restarting; try again in a moment.",
  "error.retry": "Try again",

  "files.title": "My files",
  "files.signedInAs": "Signed in as {email}",
  "files.folder": "Folder: {name}",
  "files.placeholder": "The file browser is coming soon.",
} satisfies Record<string, string>;

export default en;
