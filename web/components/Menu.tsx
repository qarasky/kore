"use client";

import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

export type MenuAction = {
  id: string;
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  /** Draw a divider above this item. */
  separated?: boolean;
};

/** Why a menu closed. Only `escape` returns focus to where it came from;
 *  after `select` the chosen action decides where focus goes. */
export type CloseReason = "escape" | "tab" | "outside" | "select";

function enabledItems(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')];
}

/**
 * A keyboard-operable `role="menu"` panel: focuses its first item when
 * mounted; ArrowUp/Down/Home/End move between items, Enter/Space activate,
 * Escape/Tab close; a pointerdown outside the panel (and outside `ignore`,
 * e.g. the trigger button) closes it.
 */
export function MenuPanel({
  id,
  label,
  items,
  onClose,
  header,
  className = "",
  style,
  panelRef,
  ignore,
}: {
  id?: string;
  label: string;
  items: MenuAction[];
  onClose: (reason: CloseReason) => void;
  header?: ReactNode;
  className?: string;
  style?: CSSProperties;
  panelRef?: RefObject<HTMLDivElement | null>;
  ignore?: RefObject<HTMLElement | null>;
}) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = panelRef ?? ownRef;
  const close = useEffectEvent((reason: CloseReason) => onClose(reason));

  useEffect(() => {
    enabledItems(ref.current)[0]?.focus();
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || ignore?.current?.contains(target)) return;
      close("outside");
    };
    const onBlurWindow = () => close("outside");
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onBlurWindow);
    window.addEventListener("resize", onBlurWindow);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onBlurWindow);
      window.removeEventListener("resize", onBlurWindow);
    };
  }, [ref, ignore]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const list = enabledItems(ref.current);
    const i = list.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    switch (e.key) {
      case "ArrowDown":
        next = list[(i + 1) % list.length];
        break;
      case "ArrowUp":
        next = list[(i - 1 + list.length) % list.length];
        break;
      case "Home":
        next = list[0];
        break;
      case "End":
        next = list[list.length - 1];
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        onClose("escape");
        return;
      case "Tab":
        e.preventDefault();
        onClose("tab");
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    next?.focus();
  }

  return (
    <div
      ref={ref}
      id={id}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={style}
      className={
        "z-50 min-w-[180px] rounded-ui border border-border-strong bg-raised py-1 " +
        "shadow-[0_12px_32px_-8px_rgba(0,0,0,0.7)] " +
        className
      }
    >
      {header}
      {items.map((item) => (
        <div key={item.id}>
          {item.separated && <div role="separator" className="my-1 border-t border-border" />}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-disabled={item.disabled || undefined}
            onClick={() => {
              if (item.disabled) return;
              onClose("select");
              item.onSelect();
            }}
            className={
              "flex w-full items-center gap-2.5 px-3 py-1.5 text-left outline-none " +
              "focus-visible:bg-accent/15 hover:bg-white/5 focus:bg-white/5 " +
              "aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent " +
              (item.danger ? "text-danger" : "text-text")
            }
          >
            <span className="flex w-4 justify-center text-muted">{item.icon}</span>
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * A button that opens a {@link MenuPanel} below it. ArrowDown/Enter/Space on
 * the button open it; Escape returns focus to the button.
 */
export function Dropdown({
  label,
  items,
  header,
  align = "left",
  buttonClassName = "",
  buttonLabel,
  children,
}: {
  /** The menu's accessible name. */
  label: string;
  items: MenuAction[];
  header?: ReactNode;
  align?: "left" | "right";
  buttonClassName?: string;
  /** The button's accessible name, if its content isn't a good one. */
  buttonLabel?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={buttonLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={buttonClassName}
      >
        {children}
      </button>
      {open && (
        <div className={`absolute top-full z-50 mt-1 ${align === "right" ? "right-0" : "left-0"}`}>
          <MenuPanel
            id={menuId}
            label={label}
            items={items}
            header={header}
            ignore={buttonRef}
            onClose={(reason) => {
              setOpen(false);
              if (reason === "escape" || reason === "tab") buttonRef.current?.focus();
            }}
          />
        </div>
      )}
    </div>
  );
}
