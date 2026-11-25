"use client";

import { NavTabs } from "@qarasky/kore-ui";
import { usePathname } from "next/navigation";
import { t, type MessageKey } from "@/lib/i18n";

const LINKS: { href: string; label: MessageKey }[] = [
  { href: "/admin", label: "admin.nav.overview" },
  { href: "/admin/users", label: "admin.nav.users" },
  { href: "/admin/settings", label: "admin.nav.settings" },
];

/** Overview / Users / Settings tabs of the admin area (kore-ui NavTabs). */
export function AdminNav() {
  const pathname = usePathname();
  return (
    <NavTabs
      label={t("admin.nav")}
      items={LINKS.map((l) => ({
        href: l.href,
        label: t(l.label),
        active: l.href === "/admin" ? pathname === "/admin" : pathname.startsWith(l.href),
      }))}
    />
  );
}
