"use client";

import { Tabs as RadixTabs } from "radix-ui";
import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useLinkComponent, type LinkComponent } from "../lib/link";

type Variant = "pills" | "underline";
const VariantContext = createContext<Variant>("pills");

/** Switch between views of the same thing without leaving the page. Root: `value`/`onValueChange` or `defaultValue`. */
export const Tabs = RadixTabs.Root;

const listClass: Record<Variant, string> = {
  pills: "flex items-center gap-1",
  underline: "flex items-center gap-5 border-b border-border",
};

const triggerClass: Record<Variant, string> = {
  pills:
    "flex min-h-control-sm items-center gap-2 rounded-ui px-3 whitespace-nowrap text-muted transition-colors " +
    "hover:bg-white/[0.04] hover:text-text data-[state=active]:bg-raised data-[state=active]:font-medium data-[state=active]:text-text " +
    "aria-[current=page]:bg-raised aria-[current=page]:font-medium aria-[current=page]:text-text",
  underline:
    "relative -mb-px flex min-h-control items-center gap-2 border-b-2 border-transparent whitespace-nowrap text-muted transition-colors " +
    "hover:text-text data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-text " +
    "aria-[current=page]:border-accent aria-[current=page]:font-medium aria-[current=page]:text-text",
};

export type TabsListProps = ComponentProps<typeof RadixTabs.List> & {
  /** pills (default): compact, for page headers. underline: for sections inside a page (user detail). */
  variant?: Variant;
};

export function TabsList({ variant = "pills", className, ...props }: TabsListProps) {
  return (
    <VariantContext value={variant}>
      <RadixTabs.List className={cn(listClass[variant], "overflow-x-auto", className)} {...props} />
    </VariantContext>
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof RadixTabs.Trigger>) {
  const variant = useContext(VariantContext);
  return <RadixTabs.Trigger className={cn(triggerClass[variant], "[&_svg]:size-4", className)} {...props} />;
}

export function TabsContent({ className, ...props }: ComponentProps<typeof RadixTabs.Content>) {
  return <RadixTabs.Content className={cn("outline-none", className)} {...props} />;
}

export type NavTabItem = { href: string; label: ReactNode; icon?: ReactNode; active?: boolean };

export type NavTabsProps = {
  /** Accessible name of the nav ("Admin sections"). */
  label: string;
  items: NavTabItem[];
  variant?: Variant;
  LinkComponent?: LinkComponent;
  className?: string;
};

/** Tabs that are links (each tab is its own URL): `<nav>` with `aria-current="page"` on the active one. */
export function NavTabs({ label, items, variant = "pills", LinkComponent, className }: NavTabsProps) {
  const Link = useLinkComponent(LinkComponent);
  return (
    <nav aria-label={label} className={cn(listClass[variant], "overflow-x-auto", className)}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(triggerClass[variant], "[&_svg]:size-4")}
        >
          {item.icon}
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
