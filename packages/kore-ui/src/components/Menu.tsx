"use client";

import { Check, ChevronRight, Circle } from "lucide-react";
import { ContextMenu as RadixContextMenu, DropdownMenu as RadixDropdownMenu } from "radix-ui";
import { useRef, type ComponentProps, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
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

/** A menu on right-click / long-press of its trigger, and on the Menu key / Shift+F10 when focus is inside it.
 *  Always offer the same actions elsewhere too (a visible "…" menu). */
export const ContextMenu = RadixContextMenu.Root;
export const ContextMenuGroup = RadixContextMenu.Group;
export const ContextMenuRadioGroup = RadixContextMenu.RadioGroup;
export const ContextMenuSub = RadixContextMenu.Sub;

/** Where a keyboard-opened context menu appears: under the start of the focused element. */
function keyboardPoint(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + Math.min(16, r.width / 2), y: r.top + Math.min(r.height, 32) };
}

function isContextMenuKey(e: KeyboardEvent): boolean {
  return e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey);
}

/**
 * The area that opens the context menu. Besides right-click and long-press it opens from the
 * keyboard (Menu key, Shift+F10) at the focused element, consistently across browsers.
 */
export function ContextMenuTrigger({ onKeyDown, onContextMenu, ...props }: ComponentProps<typeof RadixContextMenu.Trigger>) {
  // The browser may follow our keydown with its own `contextmenu` event (at 0,0 in some browsers): ignore it.
  const keyboardOpenedAt = useRef(0);
  return (
    <RadixContextMenu.Trigger
      {...props}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented || !isContextMenuKey(e)) return;
        e.preventDefault();
        const target = e.target instanceof Element ? e.target : e.currentTarget;
        const { x, y } = keyboardPoint(target);
        keyboardOpenedAt.current = Date.now();
        e.currentTarget.dispatchEvent(
          new globalThis.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }),
        );
      }}
      onContextMenu={(e: MouseEvent<HTMLSpanElement>) => {
        if (e.isTrusted && Date.now() - keyboardOpenedAt.current < 500) {
          e.preventDefault();
          return;
        }
        onContextMenu?.(e);
      }}
    />
  );
}

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

export function ContextMenuCheckboxItem({ className, children, ...props }: ComponentProps<typeof RadixContextMenu.CheckboxItem>) {
  return (
    <RadixContextMenu.CheckboxItem className={cn(itemClass, "pl-10", className)} {...props}>
      <RadixContextMenu.ItemIndicator className="absolute left-3.5 flex text-accent">
        <Check aria-hidden className="size-4" />
      </RadixContextMenu.ItemIndicator>
      {children}
    </RadixContextMenu.CheckboxItem>
  );
}

export function ContextMenuRadioItem({ className, children, ...props }: ComponentProps<typeof RadixContextMenu.RadioItem>) {
  return (
    <RadixContextMenu.RadioItem className={cn(itemClass, "pl-10", className)} {...props}>
      <RadixContextMenu.ItemIndicator className="absolute left-[18px] flex text-accent">
        <Circle aria-hidden className="size-2 fill-current" />
      </RadixContextMenu.ItemIndicator>
      {children}
    </RadixContextMenu.RadioItem>
  );
}

export function ContextMenuSubTrigger({ className, icon, children, ...props }: ComponentProps<typeof RadixContextMenu.SubTrigger> & { icon?: ReactNode }) {
  return (
    <RadixContextMenu.SubTrigger className={cn(itemClass, "data-[state=open]:bg-white/5", className)} {...props}>
      <ItemInner icon={icon}>{children}</ItemInner>
      <ChevronRight aria-hidden className="size-4 text-muted" />
    </RadixContextMenu.SubTrigger>
  );
}

export function ContextMenuSubContent({ className, ...props }: ComponentProps<typeof RadixContextMenu.SubContent>) {
  return (
    <RadixContextMenu.Portal>
      <RadixContextMenu.SubContent sideOffset={2} collisionPadding={8} className={cn(contentClass, className)} {...props} />
    </RadixContextMenu.Portal>
  );
}

export function ContextMenuSeparator({ className, ...props }: ComponentProps<typeof RadixContextMenu.Separator>) {
  return <RadixContextMenu.Separator className={cn("my-1 h-px bg-border", className)} {...props} />;
}

/* ---------- Point menu ---------- */

/** Why a PointMenu closed: an item was chosen, Escape, or a press/focus outside. */
export type PointMenuCloseReason = "select" | "escape" | "outside";

export type MenuPoint = { x: number; y: number };

/** The point to open a PointMenu at for a mouse event (the cursor) or a keyboard event (the focused element). */
export function pointFromEvent(event: { clientX?: number; clientY?: number; target?: EventTarget | null; currentTarget?: EventTarget | null }): MenuPoint {
  const fromKeyboard = event.clientX === undefined || (event.clientX === 0 && event.clientY === 0);
  if (!fromKeyboard) return { x: event.clientX!, y: event.clientY! };
  const el = (event.target ?? event.currentTarget) as Element | null;
  return el && typeof el.getBoundingClientRect === "function" ? keyboardPoint(el) : { x: 0, y: 0 };
}

export type PointMenuProps = {
  /** Where to open (viewport coordinates). `null` = closed. */
  point: MenuPoint | null;
  /** Called when it closes, with why. Set `point` to null here. */
  onClose: (reason: PointMenuCloseReason) => void;
  /** Accessible name of the menu ("Actions for edge-02"). */
  label: string;
  /** Where focus goes on close. Default: stays where it was (the canvas). Return an element to focus it. */
  returnFocus?: () => HTMLElement | null | undefined;
  /** MenuItem / MenuSeparator / MenuSub… (the dropdown Menu parts). */
  children: ReactNode;
  className?: string;
};

/**
 * A Menu opened at a point instead of under a button: for canvases and custom surfaces that
 * handle right-click themselves (`onContextMenu={(e) => { e.preventDefault(); setPoint(pointFromEvent(e)); }}`),
 * or to open a context menu from your own keyboard shortcut. Same items and keyboard as Menu.
 * Non-modal, so an item can open a dialog as the menu closes.
 */
export function PointMenu({ point, onClose, label, returnFocus, children, className }: PointMenuProps) {
  const reason = useRef<PointMenuCloseReason>("select");
  if (!point) return null;
  return (
    <RadixDropdownMenu.Root
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) {
          onClose(reason.current);
          reason.current = "select";
        }
      }}
    >
      <RadixDropdownMenu.Trigger asChild>
        <span aria-hidden="true" tabIndex={-1} className="pointer-events-none fixed size-0" style={{ left: point.x, top: point.y }} />
      </RadixDropdownMenu.Trigger>
      <RadixDropdownMenu.Portal>
        <RadixDropdownMenu.Content
          aria-label={label}
          // Radix names the menu after its (empty) trigger; the label is the name.
          aria-labelledby={undefined}
          side="bottom"
          align="start"
          sideOffset={2}
          collisionPadding={8}
          onContextMenu={(e) => e.preventDefault()}
          onEscapeKeyDown={() => (reason.current = "escape")}
          onInteractOutside={() => (reason.current = "outside")}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            returnFocus?.()?.focus();
          }}
          className={cn(contentClass, className)}
        >
          {children}
        </RadixDropdownMenu.Content>
      </RadixDropdownMenu.Portal>
    </RadixDropdownMenu.Root>
  );
}

/** Class strings, for app-specific menu parts that must match. */
export const menuClasses = { content: contentClass, item: itemClass };
