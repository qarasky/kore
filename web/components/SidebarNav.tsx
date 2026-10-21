"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useDropTarget } from "@/hooks/useDropTarget";
import { useMoveNodes } from "@/hooks/useMoveNodes";
import { t } from "@/lib/i18n";
import { activeMove, endMove, isNoopMove } from "@/lib/moveDrag";
import type { Space } from "@/lib/nodes";
import { DriveIcon, ShieldIcon, TrashIcon, UsersIcon } from "./icons";

/** `space`: the link is a drop target moving dragged rows to that space's root. */
type Item = { href: string; label: string; icon: ReactNode; space?: Space };

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Section links with the current one marked (`aria-current="page"`). */
export function SidebarNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items: Item[] = [
    { href: "/files", label: t("nav.myFiles"), icon: <DriveIcon />, space: "personal" },
    { href: "/shared", label: t("nav.shared"), icon: <UsersIcon />, space: "shared" },
    { href: "/trash", label: t("nav.trash"), icon: <TrashIcon /> },
  ];
  if (isAdmin) items.push({ href: "/admin", label: t("nav.admin"), icon: <ShieldIcon /> });

  return (
    <nav aria-label={t("nav.label")}>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.href}>
            <NavLink item={item} active={isActive(pathname, item.href)} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function NavLink({ item, active }: { item: Item; active: boolean }) {
  const move = useMoveNodes();
  const drop = useDropTarget<HTMLAnchorElement>({
    accepts: (e) => {
      const p = activeMove(e);
      return !!item.space && p !== null && !isNoopMove(p, { space: item.space, parentId: null });
    },
    onDrop: (e) => {
      const p = activeMove(e);
      endMove();
      if (p && item.space) void move(p, { space: item.space, parentId: null });
    },
  });
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      {...drop.props}
      data-drop-target={drop.active || undefined}
      className={
        "flex items-center gap-2.5 rounded-ui px-2.5 py-1.5 transition-colors " +
        (drop.active
          ? "bg-accent/25 text-text ring-2 ring-accent"
          : active
            ? "bg-raised font-medium text-text"
            : "text-muted hover:bg-white/[0.04] hover:text-text")
      }
    >
      <span className={active || drop.active ? "text-accent" : ""}>{item.icon}</span>
      {item.label}
    </Link>
  );
}
