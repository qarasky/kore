"use client";

import type { ReactNode } from "react";
import { ToastProvider, type ToastProviderProps } from "../components/Toast";
import { TooltipProvider } from "../components/Tooltip";
import { LinkProvider, PlainLink, type LinkComponent } from "./link";
import { ThemeProvider, type ThemeProviderProps } from "./ThemeProvider";

export type KoreProviderProps = {
  /** The router's link (Next: `import Link from "next/link"`). Default: a plain `<a>`. */
  linkComponent?: LinkComponent;
  /** Toast labels. */
  toast?: Omit<ToastProviderProps, "children">;
  /** Theme behaviour (default theme, storage key, a change callback). The defaults keep the Color theme. */
  theme?: Omit<ThemeProviderProps, "children">;
  children: ReactNode;
};

/** Wrap the app once: sets the link component, applies the theme, and hosts tooltips and toasts. */
export function KoreProvider({ linkComponent, toast, theme, children }: KoreProviderProps) {
  return (
    <ThemeProvider {...theme}>
      <LinkProvider component={linkComponent ?? PlainLink}>
        <TooltipProvider>
          <ToastProvider {...toast}>{children}</ToastProvider>
        </TooltipProvider>
      </LinkProvider>
    </ThemeProvider>
  );
}
