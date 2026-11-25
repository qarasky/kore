"use client";

import { Sidebar, SidebarItem, SidebarNav, useAppShell } from "@qarasky/kore-ui";
import { Settings } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { t } from "@/lib/i18n";
import { CalendarList } from "./CalendarList";
import { MiniMonth } from "./MiniMonth";
import { SearchBox } from "./SearchBox";
import { useShell } from "./ShellContext";
import { ViewSwitcher } from "./ViewSwitcher";

/**
 * kore-ui's Sidebar: the mini month and the calendar list (app content), Settings at the bottom.
 * Search sits at the top; in the phone drawer the view switcher joins it.
 */
export function CalendarSidebar() {
  const { day } = useShell();
  const inDrawer = !!useAppShell()?.inDrawer;
  const pathname = usePathname();
  const search = useSearchParams();
  const query = pathname === "/search" ? (search.get("q") ?? "") : "";
  const sidebar = (
    <Sidebar
      header={
        <div className="flex flex-col gap-3">
          {inDrawer ? <ViewSwitcher /> : null}
          <SearchBox key={query} initial={query} className="w-full" />
        </div>
      }
      footer={
        <SidebarNav label={t("nav.main")}>
          <SidebarItem href="/settings" icon={<Settings />} active={pathname.startsWith("/settings")}>
            {t("nav.settings")}
          </SidebarItem>
        </SidebarNav>
      }
    >
      <div className="px-1 pt-1">
        <MiniMonth key={day.slice(0, 7)} />
      </div>
      <CalendarList />
    </Sidebar>
  );
  return inDrawer ? (
    <div data-testid="mobile-nav" className="flex min-h-full flex-1 flex-col">
      {sidebar}
    </div>
  ) : (
    sidebar
  );
}
