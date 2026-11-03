"use client";

import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { useLinkComponent, type LinkComponent } from "../lib/link";

export type SettingsNavItem = {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  /** A link (one URL per section)… */
  href?: string;
  /** …or a handler (one page, sections in the hash). */
  onSelect?: () => void;
};

export type SettingsLayoutProps = {
  /** Sections, in order. Six at most; group the rest. */
  items: SettingsNavItem[];
  /** The id of the section on screen. */
  current: string;
  /** Accessible name of the section nav. Default "Settings sections". */
  navLabel?: string;
  /** Above the content column, e.g. "Saving…/Saved" or the section title. */
  header?: ReactNode;
  children: ReactNode;
  LinkComponent?: LinkComponent;
  className?: string;
};

/**
 * Settings: a 200px section nav on the left and one 576px content column. Below 768px the nav
 * becomes a scrolling row of pills above the content. Fills the AppShell main panel.
 */
export function SettingsLayout({
  items,
  current,
  navLabel = "Settings sections",
  header,
  children,
  LinkComponent,
  className,
}: SettingsLayoutProps) {
  const Link = useLinkComponent(LinkComponent);
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col md:flex-row", className)}>
      <nav
        aria-label={navLabel}
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 md:w-settings-nav md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0 md:p-3"
      >
        {items.map((item) => {
          const active = item.id === current;
          const classes = cn(
            "flex min-h-control-sm shrink-0 items-center gap-2.5 rounded-ui px-3 text-left whitespace-nowrap transition-colors md:min-h-control",
            "[&_svg:not([class*='size-'])]:size-4",
            active ? "bg-raised font-medium text-text" : "text-muted hover:bg-white/[0.04] hover:text-text",
          );
          const inner = (
            <>
              {item.icon ? (
                <span aria-hidden="true" className={cn("flex", active && "text-accent")}>
                  {item.icon}
                </span>
              ) : null}
              {item.label}
            </>
          );
          return item.href ? (
            <Link key={item.id} href={item.href} aria-current={active ? "page" : undefined} onClick={item.onSelect} className={classes}>
              {inner}
            </Link>
          ) : (
            <button key={item.id} type="button" aria-current={active ? "page" : undefined} onClick={item.onSelect} className={classes}>
              {inner}
            </button>
          );
        })}
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="w-full max-w-form px-4 py-5 md:px-8 md:py-6">
          {header}
          {children}
        </div>
      </div>
    </div>
  );
}

export type SettingsSectionProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Right of the title (e.g. a Switch for the whole section, or "Add"). */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/** A titled block of a settings page. Blocks are separated by hairlines. */
export function SettingsSection({ title, description, actions, children, className }: SettingsSectionProps) {
  return (
    <section className={cn("border-b border-border py-6 first:pt-0 last:border-b-0", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-heading font-semibold tracking-[-0.01em]">{title}</h2>
          {description ? <p className="mt-1 text-sub text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="mt-4 flex flex-col gap-4">{children}</div> : null}
    </section>
  );
}
