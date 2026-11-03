"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { Popover as RadixPopover } from "radix-ui";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "../lib/cn";
import { useFieldControl } from "./Field";
import { controlClass } from "./Input";
import { Spinner } from "./Spinner";

export type ComboboxOption<V extends string = string> = {
  value: V;
  label: string;
  /** A muted second line or right-hand hint ("UTC+05:00"). */
  description?: string;
  /** Extra words that match the search ("Kazakhstan" for Asia/Almaty). */
  keywords?: string[];
  disabled?: boolean;
};

/** Default filter: every word of the query appears in the label, description or keywords (case- and accent-insensitive). */
export function defaultComboboxFilter(option: ComboboxOption, query: string): boolean {
  const norm = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const hay = norm([option.label, option.description ?? "", ...(option.keywords ?? [])].join(" "));
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

export type ComboboxProps<V extends string = string> = {
  value?: V | null;
  defaultValue?: V | null;
  onValueChange?: (value: V, option: ComboboxOption<V>) => void;
  /** The choices (filtered locally). Or use `loadOptions`. */
  options?: readonly ComboboxOption<V>[];
  /** Custom local filter. Default: all query words must match label/description/keywords. */
  filter?: (option: ComboboxOption<V>, query: string) => boolean;
  /** Async search: called (debounced) with the query, including "" when it opens. Replaces `options` filtering. */
  loadOptions?: (query: string, signal: AbortSignal) => Promise<readonly ComboboxOption<V>[]>;
  /** Debounce for `loadOptions` in ms. Default 200. */
  debounceMs?: number;
  /** Label for the current value when it isn't in `options` (async mode, first render). */
  selectedLabel?: string;
  /** Trigger text when nothing is selected. */
  placeholder?: string;
  /** Placeholder of the search field. Default "Search". */
  searchPlaceholder?: string;
  /** Shown when nothing matches. Default "No matches". */
  emptyText?: ReactNode;
  /** Shown while `loadOptions` runs. Default "Searching…". */
  loadingText?: ReactNode;
  /** Shown when `loadOptions` rejects. Default "Couldn't load results. Try again." */
  errorText?: ReactNode;
  /** Render at most this many matches (keeps long lists fast). Default 100. */
  limit?: number;
  /** Adds a hidden input for plain form submission. */
  name?: string;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  size?: "md" | "sm";
  /** Classes for the trigger. */
  className?: string;
  /** Classes for the popup (e.g. a width). Default: as wide as the trigger, at least 280px. */
  contentClassName?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

/**
 * Pick one value from a long or remote list by typing (time zones, users, folders).
 * A Select-like trigger opens a popup with a search field (`role="combobox"`) and a `listbox`.
 * Keyboard: Enter/Space/ArrowDown open; type to filter; arrows, Home/End and PageUp/PageDown move;
 * Enter selects; Escape closes and returns focus to the trigger.
 */
export function Combobox<V extends string = string>({
  value: valueProp,
  defaultValue = null,
  onValueChange,
  options = [],
  filter = defaultComboboxFilter as (option: ComboboxOption<V>, query: string) => boolean,
  loadOptions,
  debounceMs = 200,
  selectedLabel,
  placeholder = "Select…",
  searchPlaceholder = "Search",
  emptyText = "No matches",
  loadingText = "Searching…",
  errorText = "Couldn't load results. Try again.",
  limit = 100,
  name,
  disabled,
  required,
  size = "md",
  className,
  contentClassName,
  ...rest
}: ComboboxProps<V>) {
  const control = useFieldControl({ ...rest, disabled, required });
  const base = useId();
  const listId = `${base}-listbox`;
  const optionId = (i: number) => `${base}-option-${i}`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [valueState, setValueState] = useState<V | null>(defaultValue);
  const value = valueProp !== undefined ? valueProp : valueState;
  // Remembers the chosen option, so its label survives async result changes.
  const [chosen, setChosen] = useState<ComboboxOption<V> | null>(null);

  const [remote, setRemote] = useState<readonly ComboboxOption<V>[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  // Async search.
  useEffect(() => {
    if (!loadOptions || !open) return;
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    const timer = window.setTimeout(
      () => {
        loadOptions(query, controller.signal).then(
          (result) => {
            if (controller.signal.aborted) return;
            setRemote(result);
            setLoading(false);
            setActive(0);
          },
          () => {
            if (controller.signal.aborted) return;
            setFailed(true);
            setLoading(false);
          },
        );
      },
      query ? debounceMs : 0,
    );
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [loadOptions, open, query, debounceMs]);

  const matches = useMemo(() => {
    const list = loadOptions ? (remote ?? []) : query.trim() ? options.filter((o) => filter(o, query)) : options;
    return list.slice(0, limit);
  }, [loadOptions, remote, options, query, filter, limit]);

  const current =
    (value != null ? options.find((o) => o.value === value) : undefined) ??
    (chosen && chosen.value === value ? chosen : undefined) ??
    (value != null ? remote?.find((o) => o.value === value) : undefined);
  const triggerText = current?.label ?? (value != null ? (selectedLabel ?? value) : null);

  const enabledIndex = useCallback(
    (from: number, step: 1 | -1) => {
      for (let i = from, n = 0; n < matches.length; i += step, n++) {
        const idx = (i + matches.length) % matches.length;
        if (!matches[idx]?.disabled) return idx;
      }
      return -1;
    },
    [matches],
  );

  // Highlight the selected option (or the first enabled one) whenever the list changes.
  useEffect(() => {
    if (!open) return;
    const selected = matches.findIndex((o) => o.value === value);
    setActive(selected >= 0 && !query ? selected : enabledIndex(0, 1));
  }, [open, matches, value, query, enabledIndex]);

  useEffect(() => {
    if (!open || active < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(active))}`);
    el?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  function choose(option: ComboboxOption<V> | undefined) {
    if (!option || option.disabled) return;
    setChosen(option);
    if (valueProp === undefined) setValueState(option.value);
    onValueChange?.(option.value, option);
    setOpen(false);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setQuery("");
      setFailed(false);
    }
  }

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const page = 8;
    switch (e.key) {
      case "ArrowDown":
        setActive((i) => enabledIndex(i + 1, 1));
        break;
      case "ArrowUp":
        setActive((i) => enabledIndex(i - 1, -1));
        break;
      case "PageDown":
        setActive((i) => enabledIndex(Math.min(matches.length - 1, i + page), -1));
        break;
      case "PageUp":
        setActive((i) => enabledIndex(Math.max(0, i - page), 1));
        break;
      case "Home":
        if (e.ctrlKey || e.metaKey || !query) setActive(enabledIndex(0, 1));
        else return;
        break;
      case "End":
        if (e.ctrlKey || e.metaKey || !query) setActive(enabledIndex(matches.length - 1, -1));
        else return;
        break;
      case "Enter":
        choose(matches[active]);
        break;
      case "Tab":
        setOpen(false);
        return;
      default:
        return;
    }
    e.preventDefault();
  }

  const status = loadOptions && loading ? "loading" : failed ? "failed" : matches.length === 0 ? "empty" : "ready";

  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger
        type="button"
        id={control.id}
        disabled={control.disabled}
        aria-haspopup="listbox"
        aria-label={control["aria-label"]}
        aria-labelledby={control["aria-labelledby"]}
        aria-describedby={control["aria-describedby"]}
        aria-invalid={control["aria-invalid"] || undefined}
        aria-required={control.required || undefined}
        onKeyDown={(e) => {
          if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
            e.preventDefault();
            onOpenChange(true);
          }
        }}
        className={cn(
          controlClass,
          "flex items-center justify-between gap-2 text-left",
          size === "sm" ? "min-h-control-sm text-sub" : "min-h-control",
          triggerText == null && "text-muted",
          className,
        )}
      >
        <span className="truncate">{triggerText ?? placeholder}</span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted" />
      </RadixPopover.Trigger>
      {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}
      <RadixPopover.Portal>
        <RadixPopover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>("input")?.focus();
          }}
          className={cn(
            "z-50 flex w-[max(280px,var(--radix-popover-trigger-width))] max-w-[calc(100vw-16px)] flex-col overflow-hidden",
            "max-h-[min(400px,var(--radix-popover-content-available-height))]",
            "rounded-ui border border-border-strong bg-raised text-text shadow-overlay outline-none",
            "origin-[var(--radix-popover-content-transform-origin)] data-[state=open]:animate-kore-pop-in data-[state=closed]:animate-kore-pop-out",
            contentClassName,
          )}
        >
          <div className="relative shrink-0 border-b border-border">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={active >= 0 && matches[active] ? optionId(active) : undefined}
              aria-label={searchPlaceholder}
              autoComplete="off"
              spellCheck={false}
              value={query}
              placeholder={searchPlaceholder}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              className="h-control w-full bg-transparent pr-3 pl-9 text-text outline-none placeholder:text-muted focus-visible:outline-none"
            />
            {loadOptions && loading ? <Spinner size={14} className="absolute top-1/2 right-3 -translate-y-1/2 text-muted" /> : null}
          </div>
          <ul ref={listRef} id={listId} role="listbox" aria-label={control["aria-label"] ?? searchPlaceholder} className="min-h-0 flex-1 overflow-y-auto py-1">
            {status === "ready" || (status === "loading" && matches.length > 0)
              ? matches.map((o, i) => {
                  const selected = o.value === value;
                  return (
                    <li
                      key={o.value}
                      id={optionId(i)}
                      role="option"
                      aria-selected={selected}
                      aria-disabled={o.disabled || undefined}
                      data-highlighted={i === active || undefined}
                      onPointerMove={() => !o.disabled && i !== active && setActive(i)}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => choose(o)}
                      className={cn(
                        "relative flex min-h-control cursor-default items-center gap-3 py-1.5 pr-3 pl-9 select-none",
                        "data-[highlighted]:bg-white/5 aria-disabled:opacity-40",
                        selected && "font-medium",
                      )}
                    >
                      {selected ? <Check aria-hidden className="absolute left-3 size-4 text-accent" /> : null}
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {o.description ? <span className="shrink-0 text-meta font-normal text-muted">{o.description}</span> : null}
                    </li>
                  );
                })
              : null}
          </ul>
          {status !== "ready" && !(status === "loading" && matches.length > 0) ? (
            <p role="status" className={cn("px-3 pt-1 pb-3 text-center text-meta", status === "failed" ? "text-danger" : "text-muted")}>
              {status === "loading" ? loadingText : status === "failed" ? errorText : emptyText}
            </p>
          ) : null}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
