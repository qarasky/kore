import { useSyncExternalStore } from "react";

function read() {
  return window.location.hash.replace(/^#\/?/, "") || "components";
}

/** Hash routing: #/components, #/app, #/users, #/settings, #/auth. */
export function useRoute(): string {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("hashchange", cb);
      return () => window.removeEventListener("hashchange", cb);
    },
    read,
    read,
  );
}
