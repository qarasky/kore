"use client";

import { LayoutGrid } from "lucide-react";
import { cn } from "../lib/cn";
import { IconButton } from "../components/IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "../components/Popover";
import { KORE_APP_IDS, KORE_PRODUCTS, productName, type AppId, type AppNames, type AppUrls } from "./apps";
import { AppMark } from "./AppMark";

export type AppGridProps = {
  /** Where each app lives. Apps without a URL are left out. */
  urls: AppUrls;
  /** The app you are in (highlighted, `aria-current`). */
  current?: AppId;
  names?: AppNames;
  /** Accessible name of the list. Default "Kore apps". */
  label?: string;
  className?: string;
  /** Called when a tile is clicked (e.g. close a menu). */
  onNavigate?: () => void;
};

/** The apps as a grid of tiles (mark, name, what it is). Used by AppSwitcher and a "Your apps" launcher. */
export function AppGrid({ urls, current, names, label = "Kore apps", className, onNavigate }: AppGridProps) {
  const apps = KORE_APP_IDS.filter((id) => urls[id]);
  return (
    <ul aria-label={label} className={cn("grid grid-cols-2 gap-1", className)}>
      {apps.map((id) => {
        const active = id === current;
        return (
          <li key={id}>
            <a
              href={urls[id]}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              className={cn(
                "flex flex-col items-center gap-2 rounded-ui px-2 py-3 text-center transition-colors hover:bg-white/5",
                active && "bg-white/[0.04]",
              )}
            >
              <span
                className={cn(
                  "grid size-10 place-items-center rounded-ui border border-border bg-surface",
                  active && "border-accent/50",
                )}
              >
                <AppMark app={id} size={20} />
              </span>
              <span className="leading-tight">
                <span className="block text-sub font-medium text-text">{productName(id, names)}</span>
                <span className="block text-2xs text-muted">{KORE_PRODUCTS[id].description}</span>
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export type AppSwitcherProps = AppGridProps & {
  /** Trigger label and tooltip. Default "Apps". */
  triggerLabel?: string;
  /** A footer link, e.g. to the Kore ID account page. */
  accountUrl?: string;
  accountLabel?: string;
};

/** The grid button in the top bar that jumps between Kore apps. */
export function AppSwitcher({ triggerLabel = "Apps", accountUrl, accountLabel = "Kore ID account", ...grid }: AppSwitcherProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label={triggerLabel} size="md" icon={<LayoutGrid />} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[296px] p-2">
        <AppGrid {...grid} />
        {accountUrl ? (
          <div className="mt-2 border-t border-border pt-2">
            <a
              href={accountUrl}
              className="flex min-h-control-sm items-center justify-center gap-2 rounded-ui text-meta text-muted hover:bg-white/5 hover:text-text"
            >
              <AppMark app="kore-id" size={14} />
              {accountLabel}
            </a>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
