"use client";

import { useId, useState } from "react";
import { weekdayLong, weekdayShort } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { matchPreset, presets, type Freq, type Recurrence, type RuleRecurrence } from "@/lib/rrule";
import { addDays, parseDay, weekday } from "@/lib/dates";
import { Button, Input, Select } from "@qarasky/kore-ui";
import { useShell } from "./ShellContext";

type Rule = RuleRecurrence;

const FREQS: Freq[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
const WEEK_START: Record<string, number> = { sun: 0, mon: 1, sat: 6 };

/**
 * Picks how an event repeats: the usual presets, or a custom rule (every N
 * days/weeks/months/years, which weekdays, how it ends). A rule the editor
 * cannot express is shown as the rule itself, read-only, and kept untouched
 * unless the person chooses a different repeat.
 */
export function RecurrenceEditor({
  value,
  onChange,
  start,
}: {
  value: Recurrence;
  onChange: (r: Recurrence) => void;
  /** The event's start day, which the presets and the monthly choices are worded around. */
  start: string;
}) {
  const { prefs } = useShell();
  const id = useId();
  const [forceCustom, setForceCustom] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const list = presets(start);
  const matched = matchPreset(value, start);

  if (value.kind === "raw" && !replacing) {
    return (
      <div className="flex flex-col gap-2" data-testid="raw-rule">
        <span className="text-meta font-medium text-muted">{t("recurrence.label")}</span>
        <div className="rounded-ui border border-border bg-bg/60 p-3">
          <p className="text-sub font-medium">{t("recurrence.rawTitle")}</p>
          <code data-testid="raw-rule-text" className="mt-1 block text-meta break-all text-muted">
            {value.rrule}
          </code>
          <p className="mt-2 text-meta text-muted">{t("recurrence.rawHint")}</p>
          <Button size="sm" className="mt-2" onClick={() => setReplacing(true)}>
            {t("recurrence.change")}
          </Button>
        </div>
      </div>
    );
  }

  const selected = value.kind === "raw" ? "raw" : matched !== null && !forceCustom ? matched : "custom";
  const options = [
    ...list.map((p) => ({ value: p.id, label: p.label })),
    { value: "custom", label: t("recurrence.custom") },
    ...(value.kind === "raw" ? [{ value: "raw", label: value.rrule, disabled: true }] : []),
  ];

  function choose(v: string) {
    if (v === "custom") {
      setForceCustom(true);
      if (value.kind !== "rule") onChange({ kind: "rule", freq: "WEEKLY", interval: 1, byDay: [weekday(start)], monthly: "dayOfMonth", end: { type: "never" } });
      return;
    }
    const p = list.find((x) => x.id === v);
    if (p) {
      setForceCustom(false);
      setReplacing(false);
      onChange(p.recurrence);
    }
  }

  const rule: Rule | null = value.kind === "rule" ? value : null;
  const showCustom = rule !== null && selected === "custom";

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-preset`} className="text-meta font-medium text-muted">
        {t("recurrence.label")}
      </label>
      <Select id={`${id}-preset`} value={selected} options={options} onValueChange={choose} />
      {showCustom && rule ? <CustomRule rule={rule} start={start} weekStart={WEEK_START[prefs.weekStart]} onChange={onChange} /> : null}
    </div>
  );
}

function CustomRule({ rule, start, weekStart, onChange }: { rule: Rule; start: string; weekStart: number; onChange: (r: Recurrence) => void }) {
  const id = useId();
  const set = (patch: Partial<Rule>) => onChange({ ...rule, ...patch });
  const [interval, setIntervalText] = useState(String(rule.interval));
  const [count, setCount] = useState(rule.end.type === "count" ? String(rule.end.count) : "10");
  const order = Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
  const { day } = parseDay(start);
  const nth = Math.ceil(day / 7);
  const ordinal = t(`rrule.ordinal.${nth === 5 ? -1 : nth}` as MessageKey);

  return (
    <div className="flex flex-col gap-3 rounded-ui border border-border p-3" data-testid="custom-rule">
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-n`} className="text-sub whitespace-nowrap text-muted">
          {t("recurrence.every")}
        </label>
        <Input
          id={`${id}-n`}
          type="number"
          min={1}
          inputMode="numeric"
          aria-label={t("recurrence.intervalLabel")}
          value={interval}
          onChange={(e) => {
            setIntervalText(e.target.value);
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n >= 1) set({ interval: n });
          }}
          className="w-20"
        />
        <div className="w-32">
          <Select
            aria-label={t("recurrence.freqLabel")}
            value={rule.freq}
            options={FREQS.map((f) => ({ value: f, label: t(`recurrence.freq.${f}` as MessageKey) }))}
            onValueChange={(freq) => set({ freq, byDay: freq === "WEEKLY" && rule.byDay.length === 0 ? [weekday(start)] : rule.byDay })}
          />
        </div>
      </div>

      {rule.freq === "WEEKLY" ? (
        <div role="group" aria-label={t("recurrence.repeatOn")} className="flex flex-wrap gap-1.5">
          {order.map((d) => {
            const on = rule.byDay.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={t("recurrence.weekdayToggle", { day: weekdayLong(d) })}
                onClick={() => {
                  const next = on ? rule.byDay.filter((x) => x !== d) : [...rule.byDay, d];
                  if (next.length > 0) set({ byDay: next.sort((a, b) => a - b) });
                }}
                className={
                  "grid size-control-sm place-items-center rounded-full text-meta font-medium transition-colors " +
                  (on ? "bg-accent text-white" : "border border-border-strong text-muted hover:bg-white/5 hover:text-text")
                }
              >
                {weekdayShort(d).slice(0, 2)}
              </button>
            );
          })}
        </div>
      ) : null}

      {rule.freq === "MONTHLY" ? (
        <Select
          aria-label={t("recurrence.monthlyBy")}
          value={rule.monthly}
          options={[
            { value: "dayOfMonth", label: t("recurrence.monthlyDay", { d: day }) },
            { value: "nthWeekday", label: t("recurrence.monthlyNth", { ordinal, day: weekdayLong(weekday(start)) }) },
          ]}
          onValueChange={(monthly) => set({ monthly })}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sub text-muted">{t("recurrence.ends")}</span>
        <div className="w-52">
          <Select
            aria-label={t("recurrence.ends")}
            value={rule.end.type}
            options={[
              { value: "never", label: t("recurrence.endNever") },
              { value: "until", label: t("recurrence.endUntil") },
              { value: "count", label: t("recurrence.endCount") },
            ]}
            onValueChange={(type) =>
              set({ end: type === "never" ? { type } : type === "until" ? { type, date: addDays(start, 90) } : { type, count: Number(count) >= 1 ? Number(count) : 10 } })
            }
          />
        </div>
        {rule.end.type === "until" ? (
          <Input
            type="date"
            aria-label={t("recurrence.endDate")}
            value={rule.end.date}
            onChange={(e) => e.target.value && set({ end: { type: "until", date: e.target.value } })}
            className="w-44"
          />
        ) : null}
        {rule.end.type === "count" ? (
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            aria-label={t("recurrence.endCountLabel")}
            value={count}
            onChange={(e) => {
              setCount(e.target.value);
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1) set({ end: { type: "count", count: n } });
            }}
            className="w-24"
          />
        ) : null}
      </div>
    </div>
  );
}
