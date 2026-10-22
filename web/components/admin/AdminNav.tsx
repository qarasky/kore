"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t, type MessageKey } from "@/lib/i18n";

const LINKS: { href: string; label: MessageKey }[] = [
  { href: "/admin", label: "admin.nav.overview" },
  { href: "/admin/users", label: "admin.nav.users" },
  { href: "/admin/settings", label: "admin.nav.settings" },
];

/** Overview / Users / Settings tabs of the admin area. */
export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label={t("admin.nav")} className="flex items-center gap-1">
      {LINKS.map((l) => {
        const active = l.href === "/admin" ? pathname === "/admin" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={
              "flex min-h-control-sm items-center rounded-ui px-3 transition-colors " +
              (active ? "bg-raised font-medium text-text" : "text-muted hover:bg-white/[0.04] hover:text-text")
            }
          >
            {t(l.label)}
          </Link>
        );
      })}
    </nav>
  );
}
