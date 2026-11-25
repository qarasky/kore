import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

/** Saves `value` shortly after it stops changing. The first non-null value is the baseline, not a change. */
export function useAutosave<T>(value: T | null, save: (v: T) => Promise<unknown>, delay = 700) {
  const [state, setState] = useState<SaveState>("idle");
  const baseline = useRef<string | null>(null);
  const pending = useRef<{ v: T; json: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;

  const run = useCallback(async () => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    setState("saving");
    try {
      await saveRef.current(p.v);
      baseline.current = p.json;
      setState("saved");
      setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1600);
    } catch { setState("error"); }
  }, []);

  useEffect(() => {
    if (value === null) return;
    const json = JSON.stringify(value);
    if (baseline.current === null) { baseline.current = json; return; }
    if (json === baseline.current) { pending.current = null; return; }
    pending.current = { v: value, json };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(), delay);
    return () => clearTimeout(timer.current);
  }, [value, delay, run]);

  // Leaving the page within the delay must not lose the edit.
  useEffect(() => () => { if (pending.current) void run(); }, [run]);

  return state;
}
