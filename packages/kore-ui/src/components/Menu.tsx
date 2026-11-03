"use client";

import { Check, ChevronRight, Circle } from "lucide-react";
import { ContextMenu as RadixContextMenu, DropdownMenu as RadixDropdownMenu } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

/* Shared look: Kore's menu panel (raised, strong hairline, 40px items, muted icons). */
const contentClass =
  "z-50 min-w-[200px] max-w-[320px] overflow-hidden rounded-ui border border-border-strong bg-raised py-1 text-text shadow-overlay " +
  "max-h-[var(--radix-dropdown-menu-content-available-height,var(--radix-context-menu-content-available-height))] overflow-y-auto " +
  "data-[state=open]:animate-kore-pop-in data-[state=closed]:animate-kore-pop-out " +
  "origin-[var(--radix-dropdown-menu-content-transform-origin,var(--radix-context-menu-content-transform-origin))]";

const itemClass =
  "relative flex min-h-control w-full cursor-default items-center gap-3 px-3.5 text-left outline-none select-none " +
  "data-[highlighted]:bg-white/5 data-[disabled]:opacity-40 " +
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

type ItemExtras = {
  /** A lucide icon, shown muted before the label. */
  icon?: ReactNode;
  /** Destructive action: red label. Put it last, after a separator. */
  danger?: boolean;
  /** A keyboard shortcut hint on the right ("⌘K"). */
  shortcut?: string;
};

function ItemInner({ icon, shortcut, children }: ItemExtras & { children?: ReactNode }) {
  return (
    <>
      {icon !== undefined ? (
        <span aria-hidden="true" className="flex w-4 justify-center text-muted [[data-danger]_&]:text-danger">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut ? <span className="ml-4 text-2xs tracking-wide text-muted">{shortcut}</span> : null}
    </>
  );
}

/* ---------- Dropdown menu ---------- */

/** A menu of actions opened from a button. Root: `open`/`onOpenChange` optional. */
export const Menu = RadixDropdownMenu.Root;
/** The button that opens the menu (use `asChild` with a Button or IconButton). */
export const MenuTrigger = RadixDropdownMenu.Trigger;
export const MenuGroup = RadixDropdownMenu.Group;
export const MenuRadioGroup = RadixDropdownMenu.RadioGroup;
export const MenuSub = RadixDropdownMenu.Sub;

export function MenuContent({ className, sideOffset = 4, align = "start", ...props }: ComponentProps<typeof RadixDropdownMenu.Content>) {
  return (
    <RadixDropdownMenu.Portal>
      <RadixDropdownMenu.Content
        sideOffset={sideOffset}
        align={align}
        collisionPadding={8}
        className={cn(contentClass, className)}
        {...props}
      />
    </RadixDropdownMenu.Portal>
  );
}

export type MenuItemProps = ComponentProps<typeof RadixDropdownMenu.Item> & ItemExtras;

/** An action. `onSelect` runs it; use `asChild` with an `<a>`/Link for navigation. */
export function MenuItem({ className, icon, danger, shortcut, children, asChild, ...props }: MenuItemProps) {
  return (
    <RadixDropdownMenu.Item
      data-danger={danger || undefined}
      className={cn(itemClass, danger && "text-danger", className)}
      asChild={asChild}
      {...props}
    >
      {asChild ? children : <ItemInner icon={icon} shortcut={shortcut}>{children}</ItemInner>}
    </RadixDropdownMenu.Item>
  );
}

export function MenuCheckboxItem({ className, children, ...props }: ComponentProps<typeof RadixDropdownMenu.CheckboxItem>) {
  return (
    <RadixDropdownMenu.CheckboxItem className={cn(itemClass, "pl-10", className)} {...props}>
      <RadixDropdownMenu.ItemIndicator className="absolute left-3.5 flex text-accent">
        <Check aria-hidden className="size-4" />
      </RadixDropdownMenu.ItemIndicator>
      {children}
    </RadixDropdownMenu.CheckboxItem>
  );
}

export function MenuRadioItem({ className, children, ...props }: ComponentProps<typeof RadixDropdownMenu.RadioItem>) {
  return (
    <RadixDropdownMenu.RadioItem className={cn(itemClass, "pl-10", className)} {...props}>
      <RadixDropdownMenu.ItemIndicator className="absolute left-[18px] flex text-accent">
        <Circle aria-hidden className="size-2 fill-current" />
      </RadixDropdownMenu.ItemIndicator>
      {children}
    </RadixDropdownMenu.RadioItem>
  );
}

/** A non-interactive heading inside the menu (e.g. who is signed in). */
export function MenuLabel({ className, ...props }: ComponentProps<typeof RadixDropdownMenu.Label>) {
  return <RadixDropdownMenu.Label className={cn("px-3.5 pt-1.5 pb-1 text-2xs font-medium text-muted", className)} {...props} />;
}

export function MenuSeparator({ className, ...props }: ComponentProps<typeof RadixDropdownMenu.Separator>) {
  return <RadixDropdownMenu.Separator className={cn("my-1 h-px bg-border", className)} {...props} />;
}

export function MenuSubTrigger({ className, icon, children, ...props }: ComponentProps<typeof RadixDropdownMenu.SubTrigger> & { icon?: ReactNode }) {
  return (
    <RadixDropdownMenu.SubTrigger className={cn(itemClass, "data-[state=open]:bg-white/5", className)} {...props}>
      <ItemInner icon={icon}>{children}</ItemInner>
      <ChevronRight aria-hidden className="size-4 text-muted" />
    </RadixDropdownMenu.SubTrigger>
  );
}

export function MenuSubContent({ className, ...props }: ComponentProps<typeof RadixDropdownMenu.SubContent>) {
  return (
    <RadixDropdownMenu.Portal>
      <RadixDropdownMenu.SubContent sideOffset={2} collisionPadding={8} className={cn(contentClass, className)} {...props} />
    </RadixDropdownMenu.Portal>
  );
}

/* ---------- Context menu ---------- */

/** A menu on right-click / long-press (and Shift+F10 / the context-menu key) of its trigger. Always offer the same actions elsewhere too. */
export const ContextMenu = RadixContextMenu.Root;
export const ContextMenuTrigger = RadixContextMenu.Trigger;
export const ContextMenuGroup = RadixContextMenu.Group;

export function ContextMenuContent({ className, ...props }: ComponentProps<typeof RadixContextMenu.Content>) {
  return (
    <RadixContextMenu.Portal>
      <RadixContextMenu.Content collisionPadding={8} className={cn(contentClass, className)} {...props} />
    </RadixContextMenu.Portal>
  );
}

export function ContextMenuItem({ className, icon, danger, shortcut, children, asChild, ...props }: ComponentProps<typeof RadixContextMenu.Item> & ItemExtras) {
  return (
    <RadixContextMenu.Item
      data-danger={danger || undefined}
      className={cn(itemClass, danger && "text-danger", className)}
      asChild={asChild}
      {...props}
    >
      {asChild ? children : <ItemInner icon={icon} shortcut={shortcut}>{children}</ItemInner>}
    </RadixContextMenu.Item>
  );
}

export function ContextMenuLabel({ className, ...props }: ComponentProps<typeof RadixContextMenu.Label>) {
  return <RadixContextMenu.Label className={cn("px-3.5 pt-1.5 pb-1 text-2xs font-medium text-muted", className)} {...props} />;
}

export function ContextMenuSeparator({ className, ...props }: ComponentProps<typeof RadixContextMenu.Separator>) {
  return <RadixContextMenu.Separator className={cn("my-1 h-px bg-border", className)} {...props} />;
}

/** Class strings, for app-specific menu parts that must match. */
export const menuClasses = { content: contentClass, item: itemClass };
