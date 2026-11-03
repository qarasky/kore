"use client";

import { Command as Cmdk } from "cmdk";
import { Search } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { CaptureOpener, useReturnFocus } from "../lib/focus";
import { withToastGuard } from "../lib/overlay";
import { overlayClass } from "./Dialog";
import { Kbd } from "./Kbd";

export type CommandData = {
  id: string;
  label: string;
  /** A lucide icon, shown muted. */
  icon?: ReactNode;
  /** Muted text on the right (a path, an email, a status). */
  description?: string;
  /** Extra words that match the search. */
  keywords?: string[];
  /** Shortcut hint on the right, e.g. "G F" or ["⌘", "N"]. */
  shortcut?: string | string[];
  disabled?: boolean;
  onSelect: () => void;
};

export type CommandGroupData = { heading: string; commands: CommandData[] };

type PaletteContext = { close: () => void };
const PaletteCtx = createContext<PaletteContext | null>(null);

/** True when another modal (a dialog, sheet or confirmation) is open: the palette won't open over it. */
function otherModalOpen(): boolean {
  return !!document.querySelector(
    '[role="dialog"][data-state="open"]:not([data-command-palette]), [role="alertdialog"][data-state="open"]',
  );
}

export type CommandShortcutOptions = {
  /** The letter used with ⌘ (macOS) or Ctrl. Default "k". */
  key?: string;
  /** Default true. */
  enabled?: boolean;
  /** Don't fire while another dialog is open. Default true. */
  ignoreWhenModalOpen?: boolean;
};

/**
 * Calls `onTrigger` on ⌘K / Ctrl+K anywhere on the page (text fields included). Use it to open your
 * own palette, or let CommandPalette's `shortcut` prop do it.
 */
export function useCommandShortcut(onTrigger: () => void, { key = "k", enabled = true, ignoreWhenModalOpen = true }: CommandShortcutOptions = {}) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== key.toLowerCase() || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (ignoreWhenModalOpen && otherModalOpen()) return;
      e.preventDefault();
      onTrigger();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onTrigger, key, enabled, ignoreWhenModalOpen]);
}

export type CommandPaletteProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  /** Global shortcut letter (⌘/Ctrl + it) that toggles the palette. Default "k"; `false` to wire it yourself. */
  shortcut?: string | false;
  /** Commands as data. Or compose `CommandGroup` / `CommandItem` children. */
  groups?: CommandGroupData[];
  children?: ReactNode;
  /** Screen-reader title. Default "Command palette". */
  title?: string;
  /** Search placeholder. Default "Search or jump to…". */
  placeholder?: string;
  /** Shown when nothing matches. Default "No results". */
  emptyText?: ReactNode;
  /** Shows a "Loading…" row (for async commands). */
  loading?: boolean;
  loadingText?: ReactNode;
  /** Controlled search text. It is cleared each time the palette opens. */
  query?: string;
  onQueryChange?: (query: string) => void;
  /** Turn cmdk's filtering off (you filter `groups` yourself from `query`). */
  shouldFilter?: boolean;
  /** Bottom hint row. Default: move / select / close keys. `null` hides it. */
  footer?: ReactNode;
  className?: string;
};

/**
 * ⌘K / Ctrl+K: search and jump anywhere, or run an action. A dialog near the top of the screen
 * with a search field, grouped results, keyboard navigation (arrows, Enter, Escape) and shortcut
 * hints. Selecting a command closes the palette and runs it. Built on cmdk.
 */
export function CommandPalette({
  open: openProp,
  onOpenChange,
  defaultOpen = false,
  shortcut = "k",
  groups,
  children,
  title = "Command palette",
  placeholder = "Search or jump to…",
  emptyText = "No results",
  loading = false,
  loadingText = "Loading…",
  query: queryProp,
  onQueryChange,
  shouldFilter,
  footer,
  className,
}: CommandPaletteProps) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setOpenState(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );
  const [queryState, setQueryState] = useState("");
  const query = queryProp ?? queryState;
  const setQuery = useCallback(
    (q: string) => {
      if (queryProp === undefined) setQueryState(q);
      onQueryChange?.(q);
    },
    [queryProp, onQueryChange],
  );
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  useCommandShortcut(toggle, { key: shortcut || "k", enabled: shortcut !== false });
  const focus = useReturnFocus();

  // Each opening starts with an empty search.
  useEffect(() => {
    if (open) setQuery("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = useCallback(() => setOpen(false), [setOpen]);

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={overlayClass} />
        <RadixDialog.Content
          data-command-palette=""
          aria-describedby={undefined}
          onCloseAutoFocus={focus.onCloseAutoFocus}
          onPointerDownOutside={withToastGuard()}
          className={cn(
            "fixed top-[12dvh] left-1/2 z-50 flex max-h-[76dvh] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden",
            "rounded-overlay border border-border-strong bg-raised text-text shadow-dialog outline-none",
            "data-[state=open]:animate-kore-dialog-in data-[state=closed]:animate-kore-dialog-out",
            className,
          )}
        >
          <CaptureOpener onMount={focus.capture} />
          <RadixDialog.Title className="sr-only">{title}</RadixDialog.Title>
          <PaletteCtx value={{ close }}>
            <Cmdk label={title} loop shouldFilter={shouldFilter} className="flex min-h-0 flex-1 flex-col">
              <div className="relative shrink-0 border-b border-border">
                <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted" />
                <Cmdk.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder={placeholder}
                  className="h-row w-full bg-transparent pr-4 pl-11 text-heading text-text outline-none placeholder:text-muted focus-visible:outline-none"
                />
              </div>
              <Cmdk.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 [&_[cmdk-list-sizer]]:flex [&_[cmdk-list-sizer]]:flex-col">
                {loading ? (
                  <Cmdk.Loading>
                    <p className="px-3 py-6 text-center text-meta text-muted">{loadingText}</p>
                  </Cmdk.Loading>
                ) : null}
                <Cmdk.Empty className="px-3 py-10 text-center text-muted">{emptyText}</Cmdk.Empty>
                {groups?.map((g) =>
                  g.commands.length ? (
                    <CommandGroup key={g.heading} heading={g.heading}>
                      {g.commands.map((c) => (
                        <CommandItem
                          key={c.id}
                          value={`${g.heading} ${c.label} ${c.id}`}
                          keywords={c.keywords}
                          icon={c.icon}
                          description={c.description}
                          shortcut={c.shortcut}
                          disabled={c.disabled}
                          onSelect={c.onSelect}
                        >
                          {c.label}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ) : null,
                )}
                {children}
              </Cmdk.List>
              {footer === null ? null : (
                <div className="flex shrink-0 items-center gap-4 border-t border-border px-4 py-2 text-2xs text-muted">
                  {footer ?? (
                    <>
                      <span className="inline-flex items-center gap-1.5">
                        <Kbd>↑</Kbd>
                        <Kbd>↓</Kbd> to move
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Kbd>↵</Kbd> to select
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Kbd>Esc</Kbd> to close
                      </span>
                    </>
                  )}
                </div>
              )}
            </Cmdk>
          </PaletteCtx>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export type CommandGroupProps = { heading: string; children: ReactNode; className?: string };

/** A titled group of CommandItems. */
export function CommandGroup({ heading, children, className }: CommandGroupProps) {
  return (
    <Cmdk.Group
      heading={heading}
      className={cn(
        "py-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:pb-1",
        "[&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted",
        className,
      )}
    >
      {children}
    </Cmdk.Group>
  );
}

export type CommandItemProps = {
  /** Search value; defaults to the text content. Must be unique. */
  value?: string;
  keywords?: string[];
  icon?: ReactNode;
  description?: string;
  shortcut?: string | string[];
  disabled?: boolean;
  /** Close the palette before running `onSelect`. Default true. */
  closeOnSelect?: boolean;
  onSelect?: () => void;
  children: ReactNode;
  className?: string;
};

/** One result: icon, label, muted description, shortcut hint. Enter or click runs it. */
export function CommandItem({
  value,
  keywords,
  icon,
  description,
  shortcut,
  disabled,
  closeOnSelect = true,
  onSelect,
  children,
  className,
}: CommandItemProps) {
  const ctx = useContext(PaletteCtx);
  const keys = typeof shortcut === "string" ? shortcut.split(" ") : shortcut;
  return (
    <Cmdk.Item
      value={value}
      keywords={keywords}
      disabled={disabled}
      onSelect={() => {
        if (closeOnSelect) ctx?.close();
        onSelect?.();
      }}
      className={cn(
        "flex min-h-control cursor-default items-center gap-3 rounded-ui px-3 select-none",
        "data-[selected=true]:bg-white/[0.06] data-[disabled=true]:opacity-40",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="flex w-4 justify-center text-muted">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {description ? <span className="max-w-[45%] shrink-0 truncate text-meta text-muted">{description}</span> : null}
      {keys?.length ? (
        <span aria-hidden="true" className="flex shrink-0 gap-1">
          {keys.map((k, i) => (
            <Kbd key={i}>{k}</Kbd>
          ))}
        </span>
      ) : null}
    </Cmdk.Item>
  );
}

/** A hairline between groups. */
export function CommandSeparator() {
  return <Cmdk.Separator className="mx-1.5 my-1 h-px bg-border" />;
}
