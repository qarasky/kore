"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type MenuItem =
  | { type: "item"; label: string; onSelect: () => void; icon?: ReactNode; danger?: boolean }
  | { type: "link"; label: string; href: string; icon?: ReactNode }
  | { type: "text"; label: string };

/**
 * A button that opens a small menu (WAI-ARIA menu button): arrows move,
 * Home/End jump, Enter/Space choose, Esc closes and returns focus, a press
 * outside closes. Links are real anchors (middle-click works).
 */
export function Menu({
  label,
  trigger,
  items,
  align = "right",
  triggerClassName = "",
}: {
  label: string;
  trigger: ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const actionable = items.filter((i) => i.type !== "text");

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    const els = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = els.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => els[(i + els.length) % els.length]?.focus();
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      go(at + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      go(at - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      go(0);
    } else if (e.key === "End") {
      e.preventDefault();
      go(els.length - 1);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const itemClass =
    "flex min-h-control w-full items-center gap-2.5 rounded-ui px-3 text-left text-sub outline-none hover:bg-raised focus-visible:bg-raised";

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={triggerClassName}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open ? (
        <div
          id={id}
          role="menu"
          aria-label={label}
          className={`absolute top-full z-50 mt-1.5 min-w-56 rounded-ui border border-border-strong bg-raised p-1 shadow-xl shadow-black/40 ${align === "right" ? "right-0" : "left-0"}`}
        >
          {items.map((item, i) => {
            if (item.type === "text") {
              return (
                <div key={i} className="truncate px-3 py-2 text-meta text-muted">
                  {item.label}
                </div>
              );
            }
            if (item.type === "link") {
              return (
                <a key={i} role="menuitem" href={item.href} className={itemClass} onClick={() => setOpen(false)}>
                  {item.icon}
                  {item.label}
                </a>
              );
            }
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={`${itemClass} ${item.danger ? "text-danger" : ""}`}
                onClick={() => {
                  setOpen(false);
                  button.current?.focus();
                  item.onSelect();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
          {actionable.length === 0 ? null : null}
        </div>
      ) : null}
    </div>
  );
}
