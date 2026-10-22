"use client";

import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { opensAbove, stepIndex, typeaheadIndex } from "@/lib/listbox";
import { ChevronDownIcon } from "./icons";

export type SelectOption<V extends string = string> = { value: V; label: string; disabled?: boolean };

const GAP = 4;
const TYPEAHEAD_MS = 500;

/** Exported so neighbouring inputs can match the trigger's look. */
export const selectTriggerClass =
  "flex min-w-0 items-center justify-between gap-2 rounded-ui border border-border bg-bg/60 min-h-control px-3 " +
  "text-left text-text outline-none transition-colors hover:border-border-strong " +
  "focus:border-accent focus:ring-2 focus:ring-accent/25 aria-invalid:border-danger/70 " +
  "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border";

/**
 * A single-value select (the WAI-ARIA "select-only combobox"): a trigger
 * button (`role="combobox"`) showing the current label, and a popup
 * `role="listbox"`. Focus stays on the trigger; the highlighted option is
 * announced through `aria-activedescendant`.
 *
 * Keyboard: Enter/Space/ArrowDown/ArrowUp open; arrows, Home/End and
 * type-ahead move; Enter (or Space) selects; Escape closes without changing
 * anything (and never closes a surrounding dialog); Tab closes. A pointerdown
 * outside closes. The popup opens upward when there is no room below.
 *
 * The popup is `position: fixed` in a portal to the trigger's enclosing
 * `<dialog>` (else `<body>`): inside a modal dialog it stays in the dialog's
 * top layer, so it is neither inert nor clipped, and the focus trap is
 * untouched. `name` adds a hidden input so plain form submission works.
 */
export function Select<V extends string>({
  id,
  name,
  value,
  options,
  onChange,
  disabled = false,
  className = "",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  id?: string;
  /** Adds `<input type="hidden" name={name} value={value}>`. */
  name?: string;
  value: V;
  options: readonly SelectOption<V>[];
  onChange: (value: V) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const base = useId();
  const listId = `${base}-listbox`;
  const optionId = (i: number) => `${base}-option-${i}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const typed = useRef({ text: "", timer: 0 });

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  function show(at: number) {
    const trigger = triggerRef.current;
    if (!trigger || disabled) return;
    setHost(trigger.closest("dialog") ?? document.body);
    setActive(at);
    setOpen(true);
  }

  function hide() {
    setOpen(false);
    window.clearTimeout(typed.current.timer);
    typed.current.text = "";
  }

  function choose(i: number) {
    const o = options[i];
    if (!o || o.disabled) return;
    hide();
    triggerRef.current?.focus();
    if (o.value !== value) onChange(o.value);
  }

  /** Type-ahead from the current highlight; returns the match (or -1). */
  function typeahead(ch: string, from: number): number {
    const t = typed.current;
    window.clearTimeout(t.timer);
    t.text += ch;
    t.timer = window.setTimeout(() => (t.text = ""), TYPEAHEAD_MS);
    return typeaheadIndex(options, t.text, from);
  }

  const fallback = () => (selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : stepIndex(options, -1, "first"));

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!open) {
      switch (e.key) {
        case "Enter":
        case " ":
        case "ArrowDown":
        case "ArrowUp":
          e.preventDefault();
          show(fallback());
          return;
        case "Home":
        case "End":
          e.preventDefault();
          show(stepIndex(options, -1, e.key === "Home" ? "first" : "last"));
          return;
      }
      if (printable) {
        e.preventDefault();
        const i = typeahead(e.key, selectedIndex);
        show(i >= 0 ? i : fallback());
      }
      return;
    }
    const move = (dir: "next" | "prev" | "first" | "last") => {
      e.preventDefault();
      setActive((a) => stepIndex(options, a, dir));
    };
    switch (e.key) {
      case "ArrowDown":
        return move("next");
      case "ArrowUp":
        return move("prev");
      case "Home":
      case "PageUp":
        return move("first");
      case "End":
      case "PageDown":
        return move("last");
      case "Enter":
        e.preventDefault();
        choose(active);
        return;
      case "Escape":
        // Keep the Escape from cancelling a surrounding <dialog>.
        e.preventDefault();
        e.stopPropagation();
        hide();
        return;
      case "Tab":
        hide();
        return;
      case " ":
        e.preventDefault();
        if (typed.current.text) {
          const i = typeahead(" ", active);
          if (i >= 0) setActive(i);
        } else choose(active);
        return;
    }
    if (printable) {
      e.preventDefault();
      const i = typeahead(e.key, active);
      if (i >= 0) setActive(i);
    }
  }

  // Place the popup next to the trigger (above when it doesn't fit below)
  // before it is painted, and keep it there while anything scrolls.
  const place = useEffectEvent(() => {
    const trigger = triggerRef.current;
    const list = listRef.current;
    if (!trigger || !list) return;
    const r = trigger.getBoundingClientRect();
    const h = list.offsetHeight;
    const above = opensAbove(r, h + GAP, window.innerHeight);
    list.style.minWidth = `${r.width}px`;
    list.style.left = `${Math.max(GAP, Math.min(r.left, window.innerWidth - list.offsetWidth - GAP))}px`;
    list.style.top = `${above ? Math.max(GAP, r.top - h - GAP) : r.bottom + GAP}px`;
    list.dataset.placement = above ? "above" : "below";
    list.style.visibility = "visible";
  });

  useLayoutEffect(() => {
    if (open && host) place();
  }, [open, host]);

  const close = useEffectEvent(() => hide());
  useEffect(() => {
    if (!open) return;
    const inside = (n: EventTarget | null) =>
      n instanceof Node && (triggerRef.current?.contains(n) || listRef.current?.contains(n));
    const onPointerDown = (e: PointerEvent) => {
      if (!inside(e.target)) close();
    };
    const onScroll = (e: Event) => {
      if (!inside(e.target)) place();
    };
    const onResize = () => close();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", onResize);
    };
  }, [open]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (open && active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // optionId is derived from a stable id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  useEffect(() => () => window.clearTimeout(typed.current.timer), []);

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid || undefined}
        disabled={disabled}
        data-value={value}
        onKeyDown={onKeyDown}
        onBlur={() => open && hide()}
        // Keyboard "clicks" (detail 0) are handled in onKeyDown.
        onClick={(e) => {
          if (e.detail === 0) return;
          if (open) hide();
          else show(fallback());
        }}
        className={`${selectTriggerClass} ${className}`}
      >
        <span className="truncate">{selected?.label ?? ""}</span>
        <ChevronDownIcon className={`size-3.5 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {name && <input type="hidden" name={name} value={value} />}
      {open &&
        host &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabel ? undefined : ariaLabelledBy}
            tabIndex={-1}
            // Keep focus on the trigger while the pointer picks an option.
            onMouseDown={(e) => e.preventDefault()}
            style={{ position: "fixed", left: 0, top: 0, visibility: "hidden" }}
            className={
              "z-50 m-0 max-h-60 list-none overflow-auto rounded-ui border border-border-strong bg-raised p-0 py-1 " +
              "text-text shadow-[0_12px_32px_-8px_rgba(0,0,0,0.7)]"
            }
          >
            {options.map((o, i) => {
              const isSelected = i === selectedIndex;
              return (
                <li
                  key={o.value}
                  id={optionId(i)}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={o.disabled || undefined}
                  data-active={i === active || undefined}
                  onMouseMove={() => !o.disabled && i !== active && setActive(i)}
                  onClick={() => choose(i)}
                  className={
                    "flex min-h-control cursor-default items-center justify-between gap-4 px-3 whitespace-nowrap " +
                    "aria-disabled:opacity-40 data-active:bg-accent/15 " +
                    (isSelected ? "font-medium" : "")
                  }
                >
                  {o.label}
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.6}
                    className={`size-3.5 shrink-0 text-accent ${isSelected ? "" : "invisible"}`}
                  >
                    <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </li>
              );
            })}
          </ul>,
          host,
        )}
    </>
  );
}
