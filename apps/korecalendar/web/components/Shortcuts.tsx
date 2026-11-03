"use client";

import { Button, Dialog, DialogBody, DialogContent, DialogFooter, Input, Kbd } from "@qarasky/kore-ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isValidDay } from "@/lib/dates";
import { t, type MessageKey } from "@/lib/i18n";
import { PREF_COOKIES, writePref } from "@/lib/prefs";
import { calendarHref, navigate } from "@/lib/range";
import { matchShortcut, SHORTCUTS, type ShortcutId } from "@/lib/shortcuts";
import type { View } from "@/lib/types";
import { OPEN_SHORTCUTS_EVENT } from "./AccountMenu";
import { useEditor } from "./EditorContext";
import { useShell } from "./ShellContext";

const VIEW_OF: Partial<Record<ShortcutId, View>> = { viewDay: "day", viewWeek: "week", viewMonth: "month", viewAgenda: "agenda" };

/** How long a key press counts as "still on its way" if the page never confirms it. */
const PENDING_MS = 1500;

/** A modal (dialog, confirmation, the phone drawer) is open. Popovers and menus don't count. */
function modalOpen(): boolean {
  return Array.from(document.querySelectorAll('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')).some(
    (el) => !el.closest("[data-radix-popper-content-wrapper]"),
  );
}

const keyLabel = (k: string) => (k === "ArrowLeft" ? "←" : k === "ArrowRight" ? "→" : k);

/** Registers the keyboard shortcuts and renders the dialogs they open. */
export function Shortcuts() {
  const router = useRouter();
  const { view, day, today, prefs } = useShell();
  const { openNew } = useEditor();
  const [help, setHelp] = useState(false);
  const [goTo, setGoTo] = useState(false);
  const latest = useRef({ view, day, today, prefs, openNew, router });
  // Where the last key press sent us, until the page catches up: a second press
  // before the first navigation lands must continue from there, not from the old day.
  const pending = useRef<{ view: View; day: string; at: number } | null>(null);

  useEffect(() => {
    latest.current = { view, day, today, prefs, openNew, router };
  });

  // The page has caught up with where we were heading.
  useEffect(() => {
    pending.current = null;
  }, [view, day]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const id = matchShortcut({
        key: e.key,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        target: { tagName: el?.tagName ?? "BODY", isContentEditable: el?.isContentEditable ?? false, role: el?.getAttribute?.("role") },
      });
      if (!id || e.defaultPrevented) return;
      // Dialogs (editor, scope prompt, this help) own the keyboard while open.
      if (modalOpen()) return;
      const s = latest.current;
      const p = pending.current && Date.now() - pending.current.at < PENDING_MS ? pending.current : null;
      const shownView = p?.view ?? s.view;
      const shownDay = p?.day ?? s.day;
      const current = shownView ?? s.prefs.view;
      const go = (v: View, d: string) => {
        pending.current = { view: v, day: d, at: Date.now() };
        s.router.push(calendarHref(v, d));
      };
      e.preventDefault();
      switch (id) {
        case "today":
          return go(current, s.today);
        case "prev":
        case "next":
          return shownView ? go(shownView, navigate(shownView, shownDay, id === "prev" ? -1 : 1)) : undefined;
        case "create":
          return s.openNew();
        case "search":
          return document.querySelector<HTMLInputElement>("input[data-search-input]")?.focus();
        case "help":
          return setHelp(true);
        case "goToDate":
          return setGoTo(true);
        default: {
          const v = VIEW_OF[id];
          if (v) {
            writePref(PREF_COOKIES.view, v);
            go(v, shownDay);
          }
        }
      }
    };
    const onOpen = () => setHelp(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    };
  }, []);

  return (
    <>
      <ShortcutsDialog open={help} onOpenChange={setHelp} />
      <GoToDateDialog
        key={goTo ? day : "closed"}
        open={goTo}
        onOpenChange={setGoTo}
        initial={day}
        onGo={(d) => {
          setGoTo(false);
          router.push(calendarHref(view ?? prefs.view, d));
        }}
      />
    </>
  );
}

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("shortcuts.title")} description={t("shortcuts.intro")} closeLabel={t("common.close")}>
        <DialogBody>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sub" data-testid="shortcuts-list">
            {SHORTCUTS.map((s) => (
              <div key={s.id} className="contents">
                <dt>{t(`shortcuts.${s.id}` as MessageKey)}</dt>
                <dd className="flex justify-end gap-1">
                  {s.keys.map((k) => (
                    <Kbd key={k}>{keyLabel(k)}</Kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
          <h3 className="mt-5 text-sub font-semibold">{t("shortcuts.moveHeading")}</h3>
          <ul className="mt-1 list-disc pl-5 text-sub text-muted">
            <li>{t("shortcuts.moveEvent")}</li>
            <li>{t("shortcuts.resizeEvent")}</li>
            <li>{t("shortcuts.dragHint")}</li>
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="primary">
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GoToDateDialog({ open, onOpenChange, initial, onGo }: { open: boolean; onOpenChange: (open: boolean) => void; initial: string; onGo: (day: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("goto.title")} size="sm" closeLabel={t("common.close")}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isValidDay(value)) onGo(value);
          }}
        >
          <DialogBody>
            <Input type="date" aria-label={t("goto.date")} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
            <Button type="submit" variant="primary" disabled={!isValidDay(value)}>
              {t("goto.go")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
