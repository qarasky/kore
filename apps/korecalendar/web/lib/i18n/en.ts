/**
 * Every UI string. Components never contain string literals: they call
 * `t(key, vars)`. `{name}` placeholders are filled from `vars`.
 */
const en = {
  "app.name": "Calendar",
  "app.titleTemplate": "%s · Calendar",
  "app.description": "A self-hosted personal calendar.",

  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.delete": "Delete",
  "common.close": "Close",
  "common.retry": "Try again",
  "common.undo": "Undo",
  "common.loading": "Loading…",

  "auth.signIn": "Sign in",
  "auth.signingIn": "Signing in…",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.passwordHint": "At least 8 characters",
  "auth.expired": "Your session ended. Sign in again to continue.",
  "auth.createAccount": "Create your account",
  "auth.creating": "Creating…",
  "auth.setupIntro": "This is a new calendar. The first account becomes the administrator.",
  "auth.signOut": "Sign out",

  "error.unreachable": "Can't reach the server. Check your connection and try again.",
  "error.generic": "Something went wrong. Try again.",
  "error.validation_error": "Some of the values aren't valid. Check the form and try again.",
  "error.unsupported_rrule": "That repeat rule isn't supported.",
  "error.invalid_json": "The request couldn't be read. Reload the page and try again.",
  "error.unauthorized": "Your session ended. Sign in again.",
  "error.forbidden": "That needs a signed-in session, not an access token.",
  "error.not_found": "That doesn't exist any more, or it isn't yours.",
  "error.bad_credentials": "Wrong email or password.",
  "error.rate_limited": "Too many attempts. Try again in {minutes} min.",
  "error.setup_closed": "An account already exists. Sign in instead.",
  "error.email_taken": "That email is already registered.",
  "error.version_conflict": "This event was changed somewhere else. Reload to see the latest.",
  "error.idempotency_conflict": "That request was already sent with different details.",
  "error.range_too_large": "That time range is too large.",
  "error.calendar_not_empty": "That calendar still has events.",
  "error.payload_too_large": "That file is too large (5 MB at most).",
  "error.busy": "The server is busy. Try again in a moment.",
  "error.internal": "The server hit an error. Try again.",

  "errorPage.unreachableTitle": "Can't reach the server",
  "errorPage.unreachableBody": "The calendar can't talk to its server right now. Your data is safe.",
  "errorPage.genericTitle": "Something went wrong",
  "errorPage.genericBody": "The page couldn't be shown.",
  "notFound.title": "Not found",
  "notFound.body": "That page doesn't exist, or it isn't yours.",
  "notFound.home": "Back to the calendar",
} as const;

export default en;
