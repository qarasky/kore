"use client";

import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { useLinkComponent, type LinkComponent } from "../lib/link";
import { Tooltip } from "../components/Tooltip";
import { useAppShell } from "./AppShell";

export type SidebarProps = {
  /** Above the nav: the main "New" button. */
  header?: ReactNode;
  /** Pinned to the bottom: storage meter, settings link. */
  footer?: ReactNode;
  /** Header when the sidebar is collapsed to icons (e.g. an IconButton "New"). Default: none. */
  collapsedHeader?: ReactNode;
  /** Footer when collapsed (e.g. a compact meter). Default: none. */
  collapsedFooter?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Sidebar content for AppShell: optional header action, nav sections, footer. */
export function Sidebar({ header: fullHeader, footer: fullFooter, collapsedHeader, collapsedFooter, children, className }: SidebarProps) {
  const collapsed = !!useAppShell()?.collapsed;
  const header = collapsed ? collapsedHeader : fullHeader;
  const footer = collapsed ? collapsedFooter : fullFooter;
  return (
    <div data-collapsed={collapsed || undefined} className={cn("flex min-h-full flex-1 flex-col gap-4", className)}>
      {header ? <div className="pl-0.5">{header}</div> : null}
      <div className="flex flex-col gap-5">{children}</div>
      {footer ? <div className="mt-auto pt-2">{footer}</div> : null}
    </div>
  );
}

export type SidebarNavProps = {
  /** Accessible name of the nav ("Sections"). */
  label: string;
  /** A visible heading above the items ("Calendars"). */
  title?: ReactNode;
  /** Next to the title, e.g. an IconButton "Add calendar". */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** A group of SidebarItems in a `<nav>` list. */
export function SidebarNav({ label, title, action, children, className }: SidebarNavProps) {
  const collapsed = !!useAppShell()?.collapsed;
  return (
    <nav aria-label={label} className={className}>
      {collapsed && (title || action) ? <div aria-hidden="true" className="mx-2 mb-2 border-t border-border" /> : null}
      {!collapsed && (title || action) ? (
        <div className="mb-1 flex min-h-control-sm items-center justify-between gap-2 pr-1 pl-3">
          <span className="text-meta font-medium text-muted">{title}</span>
          {action}
        </div>
      ) : null}
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </nav>
  );
}

export type SidebarItemProps = {
  /** Link target. Omit and pass `onClick` for a button. */
  href?: string;
  onClick?: () => void;
  /** A lucide icon (16px; accent when active). */
  icon?: ReactNode;
  /** The current section: highlighted and `aria-current="page"`. */
  active?: boolean;
  /** Right side: a count or badge. */
  trailing?: ReactNode;
  children: ReactNode;
  /** Tooltip text when the sidebar is collapsed, if `children` isn't plain text. */
  tooltip?: string;
  LinkComponent?: LinkComponent;
  className?: string;
};

/** One nav entry: 40px, icon + label, the current one on a raised pill. */
export function SidebarItem({ href, onClick, icon, active = false, trailing, children, tooltip, LinkComponent, className }: SidebarItemProps) {
  const shell = useAppShell();
  const Link = useLinkComponent(LinkComponent);
  const collapsed = !!shell?.collapsed;
  const classes = cn(
    "flex min-h-control w-full items-center gap-3 rounded-ui px-3 text-left transition-colors [&_svg:not([class*='size-'])]:size-4",
    collapsed && "justify-center gap-0 px-0",
    active ? "bg-raised font-medium text-text" : "text-muted hover:bg-white/[0.04] hover:text-text",
    className,
  );
  const handle = () => {
    onClick?.();
    if (shell?.inDrawer) shell.setDrawerOpen(false);
  };
  const inner = (
    <>
      {icon ? (
        <span aria-hidden="true" className={cn("flex shrink-0", active && "text-accent")}>
          {icon}
        </span>
      ) : null}
      <span className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate"}>{children}</span>
      {trailing && !collapsed ? <span className="shrink-0 text-meta font-normal text-muted">{trailing}</span> : null}
    </>
  );
  const element = href ? (
    <Link href={href} aria-current={active ? "page" : undefined} onClick={handle} className={classes}>
      {inner}
    </Link>
  ) : (
    <button type="button" aria-current={active ? "page" : undefined} onClick={handle} className={classes}>
      {inner}
    </button>
  );
  const tip = tooltip ?? (typeof children === "string" ? children : undefined);
  return <li>{collapsed && tip ? <Tooltip content={tip} side="right">{element}</Tooltip> : element}</li>;
}
