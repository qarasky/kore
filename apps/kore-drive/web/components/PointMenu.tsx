"use client";

import { Menu, MenuContent, MenuTrigger } from "@qarasky/kore-ui";
import { useRef, type ReactNode } from "react";

/** How a PointMenu closed: an item was chosen, Escape, or a click/focus outside. */
export type PointMenuClose = "select" | "escape" | "outside";

/**
 * kore-ui's Menu opened at a viewport point (a right-click, or a row's position
 * for the keyboard's context-menu key) instead of under a button. Mount it to
 * open it; `onClose` says why it closed, and focus is left to the caller.
 * Children are kore-ui `MenuItem`s / `MenuSeparator`s.
 */
export function PointMenu({
  x,
  y,
  label,
  onClose,
  children,
}: {
  x: number;
  y: number;
  label: string;
  onClose: (how: PointMenuClose) => void;
  children: ReactNode;
}) {
  const how = useRef<PointMenuClose>("select");
  return (
    <Menu
      open
      // Non-modal: an item may open a dialog while this unmounts; a modal menu
      // would leave the body's pointer-events lock behind (Radix).
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose(how.current);
      }}
    >
      <MenuTrigger asChild>
        <span aria-hidden="true" tabIndex={-1} className="pointer-events-none fixed size-0" style={{ left: x, top: y }} />
      </MenuTrigger>
      <MenuContent
        aria-label={label}
        side="bottom"
        align="start"
        sideOffset={0}
        collisionPadding={8}
        onEscapeKeyDown={() => (how.current = "escape")}
        onInteractOutside={() => (how.current = "outside")}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {children}
      </MenuContent>
    </Menu>
  );
}
