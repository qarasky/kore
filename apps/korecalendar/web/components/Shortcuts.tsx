"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { isValidDay } from "@/lib/dates";
import { t, type MessageKey } from "@/lib/i18n";
import { PREF_COOKIES, writePref } from "@/lib/prefs";
import { calendarHref, navigate } from "@/lib/range";
import { matchShortcut, SHORTCUTS, type ShortcutId } from "@/lib/shortcuts";
import type { View } from "@/lib/types";
import { OPEN_SHORTCUTS_EVENT } from "./AccountMenu";
import { Button } from "./Button";
import { useEditor } from "./EditorContext";
import { inputClass } from "./Field";
import { Modal } from "./Modal";
import { useShell } from "./ShellContext";

const VIEW_OF: Partial<Record<ShortcutId, View>> = { viewDay: "day", viewWeek: "week", viewMonth: "month", viewAgenda: "agenda" };

const keyLabel = (k: string) => (k === "ArrowLeft" ? "←" : k === "ArrowRight" ? "→" : k);

/** Registers the keyboard shortcuts and renders the dialogs they open. */
export function Shortcuts() {
  const router = useRouter();
  const { view, day, today, prefs } = useShell();
  const { openNew } = useEditor();
  const [help, setHelp] = useState(false);
  const [goTo, setGoTo] = useState(false);
  const latest = useRef({ view, day, today, prefs, openNew, router });

  useEffect(() => {
    latest.current = { view, day, today, prefs, openNew, router };
  });

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
      if (document.querySelector("dialog[open]")) return;
      const s = latest.current;
      const current = s.view ?? s.prefs.view;
      const go = (v: View, d: string) => s.router.push(calendarHref(v, d));
      e.preventDefault();
      switch (id) {
        case "today":
          return go(current, s.today);
        case "prev":
        case "next":
          return s.view ? go(s.view, navigate(s.view, s.day, id === "prev" ? -1 : 1)) : undefined;
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
            go(v, s.day);
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
      {help ? <ShortcutsDialog onClose={() => setHelp(false)} /> : null}
      {goTo ? (
        <GoToDateDialog
          initial={day}
          onClose={() => setGoTo(false)}
          onGo={(d) => {
            setGoTo(false);
            router.push(calendarHref(view ?? prefs.view, d));
          }}
        />
      ) : null}
    </>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  return (
    <Modal labelledBy={titleId} onClose={onClose} className="w-[min(480px,calc(100vw-24px))]">
      <div className="p-5">
        <h2 id={titleId} className="text-title font-semibold tracking-[-0.01em]">
          {t("shortcuts.title")}
        </h2>
        <p className="mt-1 text-sub text-muted">{t("shortcuts.intro")}</p>
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sub" data-testid="shortcuts-list">
          {SHORTCUTS.map((s) => (
            <div key={s.id} className="contents">
              <dt>{t(`shortcuts.${s.id}` as MessageKey)}</dt>
              <dd className="flex justify-end gap-1">
                {s.keys.map((k) => (
                  <kbd key={k} className="min-w-6 rounded-[4px] border border-border-strong bg-bg/60 px-1.5 text-center font-mono text-meta">
                    {keyLabel(k)}
                  </kbd>
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
        <div className="mt-5 flex justify-end">
          <Button onClick={onClose} variant="primary">
            {t("common.close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function GoToDateDialog({ initial, onClose, onGo }: { initial: string; onClose: () => void; onGo: (day: string) => void }) {
  const titleId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  return (
    <Modal labelledBy={titleId} onClose={onClose} initialFocus={input} className="w-[min(360px,calc(100vw-24px))]">
      <form
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (isValidDay(value)) onGo(value);
        }}
      >
        <h2 id={titleId} className="text-title font-semibold tracking-[-0.01em]">
          {t("goto.title")}
        </h2>
        <input ref={input} type="date" aria-label={t("goto.date")} value={value} onChange={(e) => setValue(e.target.value)} className={`${inputClass} mt-4 w-full`} />
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={!isValidDay(value)}>
            {t("goto.go")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
