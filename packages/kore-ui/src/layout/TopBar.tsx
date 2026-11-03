"use client";

import { Menu as MenuIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { useLinkComponent, type LinkComponent } from "../lib/link";
import { useAppShell } from "./AppShell";

export type TopBarProps = {
  /** Wordmark (default: the AppShell's `brand`). */
  brand?: ReactNode;
  /** Wordmark link (default: the AppShell's `brandHref`). */
  brandHref?: string;
  /** The middle: search, view controls, the page's title on mobile. Grows. */
  children?: ReactNode;
  /** Right side: AppSwitcher, AccountMenu, a primary "New" button. */
  actions?: ReactNode;
  LinkComponent?: LinkComponent;
  className?: string;
};

/**
 * The bar across the top of the AppShell (60px): menu button (narrow screens), wordmark in a
 * column as wide as the sidebar, flexible middle, actions on the right.
 */
export function TopBar({ brand: brandProp, brandHref: hrefProp, children, actions, LinkComponent, className }: TopBarProps) {
  const shell = useAppShell();
  const Link = useLinkComponent(LinkComponent);
  const brand = brandProp ?? shell?.brand;
  const brandHref = hrefProp ?? shell?.brandHref;
  const hasDrawer = !!shell?.menuLabel;

  return (
    <header className={cn("flex h-topbar shrink-0 items-center gap-2 pr-3 pl-3 md:gap-4 md:pl-5", className)}>
      {hasDrawer ? (
        <button
          type="button"
          aria-label={shell!.menuLabel}
          aria-expanded={shell!.drawerOpen}
          onClick={() => shell!.setDrawerOpen(true)}
          className="grid size-control place-items-center rounded-ui text-muted hover:bg-white/5 hover:text-text md:hidden"
        >
          <MenuIcon aria-hidden className="size-5" />
        </button>
      ) : null}
      {brand ? (
        <div className={cn("flex shrink-0 items-center text-brand", hasDrawer && "md:w-[calc(var(--spacing-sidebar)-24px)]", hasDrawer && children ? "max-sm:hidden" : "")}>
          {brandHref ? (
            <Link href={brandHref} className="rounded-ui">
              {brand}
            </Link>
          ) : (
            brand
          )}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}
