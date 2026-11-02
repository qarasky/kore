"use client";

import { useId, useState } from "react";
import { t } from "@/lib/i18n";
import { addReminder, describeReminder, reminderPresets, toMinutes, type ReminderUnit } from "@/lib/reminders";
import { Button } from "./Button";
import { inputClass } from "./Field";
import { XIcon } from "./icons";
import { Select } from "./Select";

const UNITS: ReminderUnit[] = ["minutes", "hours", "days", "weeks"];

/** The reminders of an event: the current ones with a remove button, a menu
 *  of presets to add, and a custom amount. Minutes before the start, longest first. */
export function RemindersEditor({ value, onChange, allDay }: { value: number[]; onChange: (minutes: number[]) => void; allDay: boolean }) {
  const labelId = useId();
  const [custom, setCustom] = useState(false);
  const [amount, setAmount] = useState("30");
  const [unit, setUnit] = useState<ReminderUnit>("minutes");
  const [invalid, setInvalid] = useState(false);

  const available = reminderPresets.filter((p) => !value.includes(p.minutes));
  const options = [
    { value: "", label: t("reminders.add") },
    ...available.map((p) => ({ value: String(p.minutes), label: describeReminder(p.minutes, allDay) })),
    { value: "custom", label: t("reminders.custom") },
  ];

  function addCustom() {
    const minutes = toMinutes(Number(amount), unit);
    if (minutes === null || amount.trim() === "") {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(addReminder(value, minutes));
    setCustom(false);
  }

  return (
    <div className="flex flex-col gap-2" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="text-sub text-muted">
        {t("reminders.label")}
      </span>
      {value.length === 0 ? (
        <p className="text-sub text-muted">{t("reminders.none")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {value.map((m) => (
            <li key={m} data-testid="reminder" className="flex min-h-control-sm items-center justify-between rounded-ui bg-bg/50 pr-1 pl-3 text-sub">
              {describeReminder(m, allDay)}
              <button
                type="button"
                aria-label={t("reminders.remove", { text: describeReminder(m, allDay) })}
                onClick={() => onChange(value.filter((x) => x !== m))}
                className="grid size-control-sm place-items-center rounded-ui text-muted hover:bg-raised hover:text-text"
              >
                <XIcon size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Select
        aria-label={t("reminders.add")}
        value=""
        options={options}
        onChange={(v) => {
          if (v === "custom") setCustom(true);
          else if (v !== "") onChange(addReminder(value, Number(v)));
        }}
      />
      {custom ? (
        <div className="flex flex-wrap items-center gap-2 rounded-ui border border-border p-2">
          <input
            type="number"
            min={0}
            inputMode="numeric"
            aria-label={t("reminders.amount")}
            aria-invalid={invalid || undefined}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${inputClass} w-24`}
          />
          <div className="w-32">
            <Select
              aria-label={t("reminders.unit")}
              value={unit}
              options={UNITS.map((u) => ({ value: u, label: t(`unit.${u}`) }))}
              onChange={setUnit}
            />
          </div>
          <Button small onClick={addCustom}>
            {t("reminders.addButton")}
          </Button>
          {invalid ? (
            <p role="alert" className="w-full text-meta text-danger">
              {t("reminders.invalid")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
