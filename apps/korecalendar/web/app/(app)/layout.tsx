import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { api } from "@/lib/api";
import { getPrefs } from "@/lib/prefs-server";
import { requireUser } from "@/lib/session";
import type { Calendar } from "@/lib/types";

/** Every signed-in page: validates the session, loads who you are and your calendars. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireUser();
  const [calendars, prefs] = await Promise.all([api<Calendar[]>("/api/calendars"), getPrefs()]);
  return (
    <AppShell me={me} calendars={calendars} prefs={prefs}>
      {children}
    </AppShell>
  );
}
