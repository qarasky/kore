import type { ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";
import { getPrefs } from "@/lib/prefs-server";
import { requireUser } from "@/lib/session";
import type { AuthConfig, Calendar } from "@/lib/types";

/** Every signed-in page: validates the session, loads who you are, your calendars and the Kore ID links. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireUser();
  const [calendars, prefs, auth] = await Promise.all([api<Calendar[]>("/api/calendars"), getPrefs(), api<AuthConfig>("/api/auth/config")]);
  return (
    <Shell me={me} calendars={calendars} prefs={prefs} kore={auth.oidc}>
      {children}
    </Shell>
  );
}
