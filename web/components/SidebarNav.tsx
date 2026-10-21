"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import { DriveIcon, ShieldIcon, TrashIcon, UsersIcon } from "./icons";

type Item = { href: string; label: string; icon: ReactNode };

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Section links with the current one marked (`aria-current="page"`). */
export function SidebarNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items: Item[] = [
    { href: "/files", label: t("nav.myFiles"), icon: <DriveIcon /> },
    { href: "/shared", label: t("nav.shared"), icon: <UsersIcon /> },
    { href: "/trash", label: t("nav.trash"), icon: <TrashIcon /> },
  ];
  if (isAdmin) items.push({ href: "/admin", label: t("nav.admin"), icon: <ShieldIcon /> });

  return (
    <nav aria-label={t("nav.label")}>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  "flex items-center gap-2.5 rounded-ui px-2.5 py-1.5 transition-colors " +
                  (active
                    ? "bg-raised font-medium text-text"
                    : "text-muted hover:bg-white/[0.04] hover:text-text")
                }
              >
                <span className={active ? "text-accent" : ""}>{item.icon}</span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
