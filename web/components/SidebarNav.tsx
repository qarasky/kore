"use client";

import { SidebarItem, SidebarNav as KoreSidebarNav, cn, type LinkProps } from "@qarasky/kore-ui";
import { HardDrive, Link2, Shield, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";
import { useDropTarget } from "@/hooks/useDropTarget";
import { useMoveNodes } from "@/hooks/useMoveNodes";
import { t } from "@/lib/i18n";
import { activeMove, endMove, isNoopMove } from "@/lib/moveDrag";
import type { Space } from "@/lib/nodes";

/** `space`: the link is a drop target moving dragged rows to that space's root. */
type Item = { href: string; label: string; icon: ReactNode; space?: Space };

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Section links (kore-ui SidebarNav) with the current one marked (`aria-current="page"`). */
export function SidebarNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items: Item[] = [
    { href: "/files", label: t("nav.myFiles"), icon: <HardDrive />, space: "personal" },
    { href: "/shared", label: t("nav.shared"), icon: <Users />, space: "shared" },
    { href: "/shared-links", label: t("nav.sharedLinks"), icon: <Link2 /> },
    { href: "/trash", label: t("nav.trash"), icon: <Trash2 /> },
  ];
  if (isAdmin) items.push({ href: "/admin", label: t("nav.admin"), icon: <Shield /> });

  return (
    <KoreSidebarNav label={t("nav.label")}>
      {items.map((item) => (
        <NavItem key={item.href} item={item} active={isActive(pathname, item.href)} />
      ))}
    </KoreSidebarNav>
  );
}

type Drop = ReturnType<typeof useDropTarget<HTMLAnchorElement>>;
const DropContext = createContext<Drop | null>(null);

/** Next's Link plus the drop-target handlers of the surrounding NavItem. */
function DropLink({ className, ...props }: LinkProps) {
  const drop = useContext(DropContext);
  return (
    <Link
      {...props}
      {...drop?.props}
      data-drop-target={drop?.active || undefined}
      className={cn(className, drop?.active && "bg-accent/25 text-text ring-2 ring-accent [&>span:first-child]:text-accent")}
    />
  );
}

function NavItem({ item, active }: { item: Item; active: boolean }) {
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
    <DropContext value={item.space ? drop : null}>
      <SidebarItem href={item.href} icon={item.icon} active={active} LinkComponent={DropLink}>
        {item.label}
      </SidebarItem>
    </DropContext>
  );
}
