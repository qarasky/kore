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
  "shared.title": "Shared space",

  "nav.label": "Sections",
  "nav.myFiles": "My files",
  "nav.shared": "Shared space",
  "nav.trash": "Trash",
  "nav.admin": "Admin",

  "storage.label": "Storage",
  "storage.used": "{used} of {quota} used",

  "search.label": "Search files",
  "search.placeholder": "Search files",

  "account.menu": "Account",
  "account.signedInAs": "Signed in as {email}",
  "account.changePassword": "Change password",
  "account.signOut": "Sign out",
  "account.signOutFailed": "Could not sign out. Try again.",

  "new.button": "New",
  "new.menu": "Create new",
  "new.folder": "New folder",
  "new.folderDefault": "New folder",

  "breadcrumbs.label": "Breadcrumb",

  "list.label": "Files",
  "list.name": "Name",
  "list.modified": "Modified",
  "list.size": "Size",
  "list.working": "Working…",
  "list.contextMenu": "Actions",
  "list.selectedCount": "{count} selected",

  "empty.folder": "Drop files here or use + New",
  "empty.folderTitle": "This folder is empty",
  "empty.shared": "Nothing in the shared space yet. Anything placed here is visible to everyone.",
  "empty.sharedTitle": "The shared space is empty",

  "action.open": "Open",
  "action.rename": "Rename",
  "action.download": "Download",
  "action.trash": "Move to trash",

  "rename.label": "Name",
  "rename.error.nameTaken": "A file with that name already exists",
  "rename.error.invalid": "That name isn't allowed",
  "rename.error.notFound": "This item no longer exists",
  "rename.error.generic": "Could not save the name. Try again.",

  "toast.trashedOne": "Moved “{name}” to trash",
  "toast.trashedMany": "Moved {count} items to trash",
  "toast.undo": "Undo",
  "toast.trashFailed": "Some items could not be moved to trash",
  "toast.restoreFailed": "Could not restore. Find the items in Trash.",
  "toast.downloadFailed": "Download failed",
  "toast.dismiss": "Dismiss",

  "date.today": "Today {time}",
  "date.yesterday": "Yesterday {time}",

  "notFound.title": "Not found",
  "notFound.description": "This folder doesn't exist, was moved to trash, or you don't have access to it.",
  "notFound.back": "Go to My files",
} satisfies Record<string, string>;

export default en;
