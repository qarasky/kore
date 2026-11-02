"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { isValidDay } from "@/lib/dates";
import { parseView } from "@/lib/range";
import { todayIn } from "@/lib/tz";
import type { Prefs } from "@/lib/prefs";
import type { Calendar, User } from "@/lib/types";
import { EditorProvider } from "./EditorProvider";
import { ShellProvider } from "./ShellContext";
import { Shortcuts } from "./Shortcuts";
import { Sidebar } from "./Sidebar";
import { ToastProvider } from "./Toast";
import { TopBar } from "./TopBar";

/**
 * The frame around every signed-in page: top bar, sidebar and the main panel
 * (two soft surfaces on the base background). The view and day come from the
 * URL, so navigation is plain links.
 */
export function AppShell({ me, calendars, prefs, children }: { me: User; calendars: Calendar[]; prefs: Prefs; children: ReactNode }) {
  const params = useParams<{ view?: string }>();
  const search = useSearchParams();
  const [, setDrawer] = useState(false);
  const today = todayIn(me.timezone);
  const date = search.get("date");
  const view = parseView(params.view);
  const day = view && date && isValidDay(date) ? date : today;

  return (
    <ShellProvider value={{ me, calendars, prefs, view, day, today }}>
      <ToastProvider>
        <EditorProvider>
          <Shortcuts />
          <div className="flex h-full flex-col">
            <TopBar onOpenMenu={() => setDrawer(true)} />
            <div className="flex min-h-0 flex-1 gap-2 px-2 pb-2">
              <Sidebar />
              <main className="min-w-0 flex-1 overflow-hidden rounded-ui bg-surface">{children}</main>
            </div>
          </div>
        </EditorProvider>
      </ToastProvider>
    </ShellProvider>
  );
}
