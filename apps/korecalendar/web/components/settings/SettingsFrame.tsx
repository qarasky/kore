"use client";

import { SettingsLayout } from "@qarasky/kore-ui";
import { Bell, CalendarDays, KeyRound, Settings, Upload, Users } from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import { useShell } from "../ShellContext";

const ITEMS = [
  { href: "/settings", label: "settings.general", icon: <Settings /> },
  { href: "/settings/calendars", label: "settings.calendars", icon: <CalendarDays /> },
  { href: "/settings/tokens", label: "settings.tokens", icon: <KeyRound /> },
  { href: "/settings/notifications", label: "settings.notifications", icon: <Bell /> },
  { href: "/settings/import-export", label: "settings.importExport", icon: <Upload /> },
  { href: "/settings/users", label: "settings.users", icon: <Users />, admin: true },
] as const;

/** kore-ui's SettingsLayout: one URL per section, the users section for administrators only. */
export function SettingsFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { me } = useShell();
  const items = ITEMS.filter((i) => !("admin" in i) || me.role === "admin").map((i) => ({ id: i.href, href: i.href, label: t(i.label), icon: i.icon }));
  return (
    <SettingsLayout items={items} current={pathname} navLabel={t("settings.nav")}>
      {children}
    </SettingsLayout>
  );
}
