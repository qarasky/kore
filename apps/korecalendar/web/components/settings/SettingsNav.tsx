"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/i18n";
import { useShell } from "../ShellContext";

const ITEMS = [
  { href: "/settings", label: "settings.general" },
  { href: "/settings/calendars", label: "settings.calendars" },
  { href: "/settings/tokens", label: "settings.tokens" },
  { href: "/settings/notifications", label: "settings.notifications" },
  { href: "/settings/import-export", label: "settings.importExport" },
  { href: "/settings/users", label: "settings.users", admin: true },
] as const;

/** Section links on the left (a scrolling row on narrow screens). */
export function SettingsNav() {
  const pathname = usePathname();
  const { me } = useShell();
  return (
    <nav aria-label={t("settings.nav")} className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 md:w-52 md:flex-col md:border-r md:border-b-0 md:p-3">
      {ITEMS.filter((i) => !("admin" in i) || me.role === "admin").map((i) => {
        const current = pathname === i.href;
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={current ? "page" : undefined}
            className={
              "min-h-control-sm shrink-0 rounded-ui px-3 py-1.5 text-sub whitespace-nowrap transition-colors " +
              (current ? "bg-raised text-text" : "text-muted hover:bg-raised/60 hover:text-text")
            }
          >
            {t(i.label)}
          </Link>
        );
      })}
    </nav>
  );
}
