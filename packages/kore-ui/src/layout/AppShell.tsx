"use client";

import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useLinkComponent, type LinkComponent } from "../lib/link";
import { Tooltip } from "../components/Tooltip";

type AppShellContextValue = {
  /** The navigation drawer (narrow screens). */
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  /** True inside the drawer: nav items close it when followed. */
  inDrawer: boolean;
  brand?: ReactNode;
  brandHref?: string;
  menuLabel: string;
  /** The sidebar can collapse to icons (AppShell `collapsible`). */
  collapsible: boolean;
  /** The desktop sidebar shows icons only. Always false inside the drawer. */
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  collapseLabels: { collapse: string; expand: string };
};

const AppShellContext = createContext<AppShellContextValue | null>(null);

/** The surrounding AppShell's state, or null outside one. */
export function useAppShell(): AppShellContextValue | null {
  return useContext(AppShellContext);
}

export type AppShellProps = {
  /** The top bar (a `TopBar`). */
  topBar: ReactNode;
  /** Sidebar content (a `Sidebar`). Shown at 256px from `md` (768px); in a drawer below. */
  sidebar?: ReactNode;
  /** The app's wordmark, used by the TopBar and the drawer header. */
  brand?: ReactNode;
  /** Where the wordmark links (the app's home). */
  brandHref?: string;
  /** Labels for the drawer (open button, dialog name, close button) and the collapse toggle. */
  labels?: Partial<{ menu: string; drawer: string; close: string; collapse: string; expand: string }>;
  /**
   * Let the desktop sidebar collapse to a 64px icon rail (tooltips name the icons). The TopBar gets a
   * toggle. The app owns persistence: store what `onSidebarCollapsedChange` reports and pass it back.
   */
  collapsible?: boolean;
  /** Controlled collapsed state (with `collapsible`). */
  sidebarCollapsed?: boolean;
  /** Initial collapsed state when uncontrolled. */
  defaultSidebarCollapsed?: boolean;
  /** Called when the user collapses or expands the sidebar. Persist it here (cookie, localStorage, settings). */
  onSidebarCollapsedChange?: (collapsed: boolean) => void;
  /** Controlled drawer state (optional). */
  drawerOpen?: boolean;
  onDrawerOpenChange?: (open: boolean) => void;
  /** Classes for the main panel. */
  mainClassName?: string;
  LinkComponent?: LinkComponent;
  /** Page content (PageHeader + body) inside the main panel. */
  children: ReactNode;
};

/**
 * The frame of every signed-in Kore page: a top bar across the top, the sidebar on the
 * left, and the content in a rounded surface panel. Below 768px the sidebar becomes a drawer
 * opened from the top bar's menu button.
 */
export function AppShell({
  topBar,
  sidebar,
  brand,
  brandHref,
  labels,
  drawerOpen: drawerOpenProp,
  onDrawerOpenChange,
  collapsible = false,
  sidebarCollapsed,
  defaultSidebarCollapsed = false,
  onSidebarCollapsedChange,
  mainClassName,
  LinkComponent,
  children,
}: AppShellProps) {
  const l = {
    menu: "Open navigation",
    drawer: "Navigation",
    close: "Close navigation",
    collapse: "Collapse sidebar",
    expand: "Expand sidebar",
    ...labels,
  };
  const [collapsedState, setCollapsedState] = useState(defaultSidebarCollapsed);
  const collapsed = collapsible && !!sidebar && (sidebarCollapsed ?? collapsedState);
  const setCollapsed = useCallback(
    (next: boolean) => {
      if (sidebarCollapsed === undefined) setCollapsedState(next);
      onSidebarCollapsedChange?.(next);
    },
    [sidebarCollapsed, onSidebarCollapsedChange],
  );
  const [drawerState, setDrawerState] = useState(false);
  const drawerOpen = drawerOpenProp ?? drawerState;
  const setDrawerOpen = useCallback(
    (open: boolean) => {
      if (drawerOpenProp === undefined) setDrawerState(open);
      onDrawerOpenChange?.(open);
    },
    [drawerOpenProp, onDrawerOpenChange],
  );
  const Link = useLinkComponent(LinkComponent);

  const outer = useMemo(
    () => ({
      drawerOpen,
      setDrawerOpen,
      inDrawer: false,
      brand,
      brandHref,
      menuLabel: sidebar ? l.menu : "",
      collapsible: collapsible && !!sidebar,
      collapsed,
      setCollapsed,
      collapseLabels: { collapse: l.collapse, expand: l.expand },
    }),
    [drawerOpen, setDrawerOpen, brand, brandHref, sidebar, l.menu, collapsible, collapsed, setCollapsed, l.collapse, l.expand],
  );
  const inner = useMemo(() => ({ ...outer, inDrawer: true, collapsed: false }), [outer]);

  return (
    <AppShellContext value={outer}>
      <div className="flex h-dvh flex-col bg-bg text-text">
        {topBar}
        <div className="flex min-h-0 flex-1">
          {sidebar ? (
            <aside
              data-collapsed={collapsed || undefined}
              className={cn(
                "hidden shrink-0 flex-col overflow-x-hidden overflow-y-auto px-3 pb-3 transition-[width] duration-200 ease-[var(--ease-standard)] md:flex",
                collapsed ? "w-sidebar-collapsed" : "w-sidebar",
              )}
            >
              {sidebar}
            </aside>
          ) : null}
          <main
            className={cn(
              "mx-2 mb-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-overlay border border-border bg-surface",
              sidebar && "md:ml-0",
              mainClassName,
            )}
          >
            {children}
          </main>
        </div>
      </div>

      {sidebar ? (
        <RadixDialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
          <RadixDialog.Portal>
            <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/60 data-[state=open]:animate-kore-fade-in data-[state=closed]:animate-kore-fade-out md:hidden" />
            <RadixDialog.Content
              aria-describedby={undefined}
              className={cn(
                "fixed inset-y-0 left-0 z-40 flex w-[min(88vw,300px)] flex-col rounded-r-overlay border-r border-border-strong bg-bg outline-none md:hidden",
                "data-[state=open]:animate-kore-drawer-in data-[state=closed]:animate-kore-drawer-out",
              )}
            >
              <RadixDialog.Title className="sr-only">{l.drawer}</RadixDialog.Title>
              <div className="flex h-topbar shrink-0 items-center justify-between gap-2 pr-3 pl-5">
                {brand ? (
                  brandHref ? (
                    <Link href={brandHref} onClick={() => setDrawerOpen(false)} className="rounded-ui text-brand">
                      {brand}
                    </Link>
                  ) : (
                    <span className="text-brand">{brand}</span>
                  )
                ) : (
                  <span />
                )}
                <RadixDialog.Close
                  aria-label={l.close}
                  className="grid size-control-sm place-items-center rounded-ui text-muted hover:bg-white/5 hover:text-text"
                >
                  <X aria-hidden className="size-4" />
                </RadixDialog.Close>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3">
                <AppShellContext value={inner}>{sidebar}</AppShellContext>
              </div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        </RadixDialog.Root>
      ) : null}
    </AppShellContext>
  );
}

export type SidebarToggleProps = { className?: string };

/**
 * The collapse/expand button of a `collapsible` AppShell (desktop only). TopBar renders one;
 * use this to put it somewhere else (e.g. the sidebar footer).
 */
export function SidebarToggle({ className }: SidebarToggleProps) {
  const shell = useAppShell();
  if (!shell?.collapsible) return null;
  const label = shell.collapsed ? shell.collapseLabels.expand : shell.collapseLabels.collapse;
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        aria-expanded={!shell.collapsed}
        onClick={() => shell.setCollapsed(!shell.collapsed)}
        className={cn(
          "hidden size-control shrink-0 place-items-center rounded-ui text-muted hover:bg-white/5 hover:text-text md:grid",
          className,
        )}
      >
        {shell.collapsed ? <PanelLeftOpen aria-hidden className="size-[18px]" /> : <PanelLeftClose aria-hidden className="size-[18px]" />}
      </button>
    </Tooltip>
  );
}
