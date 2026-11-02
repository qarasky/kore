"use client";

import Link from "next/link";
import { t } from "@/lib/i18n";
import { CalendarList } from "./CalendarList";
import { SettingsIcon } from "./icons";
import { MiniMonth } from "./MiniMonth";
import { useShell } from "./ShellContext";

/** Mini month, calendar list and a link to Settings. Shared by the desktop
 *  panel and the mobile drawer. */
export function SidebarContent() {
  const { day } = useShell();
  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-3">
      <MiniMonth key={day.slice(0, 7)} />
      <CalendarList />
      <div className="mt-auto">
        <Link href="/settings" className="flex min-h-control-sm items-center gap-2.5 rounded-ui px-1.5 text-sub text-muted hover:bg-raised hover:text-text">
          <SettingsIcon size={16} />
          {t("nav.settings")}
        </Link>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside aria-label={t("nav.sidebar")} className="hidden w-sidebar shrink-0 overflow-hidden rounded-ui bg-surface md:block">
      <SidebarContent />
    </aside>
  );
}
