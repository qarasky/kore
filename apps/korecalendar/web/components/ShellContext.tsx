"use client";

import { createContext, useContext } from "react";
import type { Prefs } from "@/lib/prefs";
import type { AuthConfig, Calendar, User, View } from "@/lib/types";

export type Shell = {
  me: User;
  calendars: Calendar[];
  prefs: Prefs;
  /** null on pages that are not a calendar view (settings, search). */
  view: View | null;
  /** The day the view is anchored on (the `date` query, else today). */
  day: string;
  today: string;
  /** Kore ID sign-in settings (account page, app switcher), or null when SSO is off. */
  kore: AuthConfig["oidc"];
};

const ShellContext = createContext<Shell | null>(null);

export const ShellProvider = ShellContext.Provider;

export function useShell(): Shell {
  const v = useContext(ShellContext);
  if (!v) throw new Error("useShell() outside the app shell");
  return v;
}
