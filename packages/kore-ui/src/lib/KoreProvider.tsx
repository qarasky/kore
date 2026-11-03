"use client";

import type { ReactNode } from "react";
import { ToastProvider, type ToastProviderProps } from "../components/Toast";
import { TooltipProvider } from "../components/Tooltip";
import { LinkProvider, PlainLink, type LinkComponent } from "./link";

export type KoreProviderProps = {
  /** The router's link (Next: `import Link from "next/link"`). Default: a plain `<a>`. */
  linkComponent?: LinkComponent;
  /** Toast labels. */
  toast?: Omit<ToastProviderProps, "children">;
  children: ReactNode;
};

/** Wrap the app once: sets the link component and hosts tooltips and toasts. */
export function KoreProvider({ linkComponent, toast, children }: KoreProviderProps) {
  return (
    <LinkProvider component={linkComponent ?? PlainLink}>
      <TooltipProvider>
        <ToastProvider {...toast}>{children}</ToastProvider>
      </TooltipProvider>
    </LinkProvider>
  );
}
