"use client";

import { useId, useState } from "react";
import { t } from "@/lib/i18n";
import { addReminder, describeReminder, reminderPresets, toMinutes, type ReminderUnit } from "@/lib/reminders";
import { Button, IconButton, Input, Select } from "@qarasky/kore-ui";
import { XIcon } from "lucide-react";

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
      <span id={labelId} className="text-meta font-medium text-muted">
        {t("reminders.label")}
      </span>
      {value.length === 0 ? (
        <p className="text-sub text-muted">{t("reminders.none")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {value.map((m) => (
            <li key={m} data-testid="reminder" className="flex min-h-control-sm items-center justify-between rounded-ui border border-border pr-1 pl-3 text-sub">
              {describeReminder(m, allDay)}
              <IconButton
                label={t("reminders.remove", { text: describeReminder(m, allDay) })}
                tooltip={false}
                icon={<XIcon />}
                onClick={() => onChange(value.filter((x) => x !== m))}
              />
            </li>
          ))}
        </ul>
      )}
      <Select
        aria-label={t("reminders.add")}
        value=""
        placeholder={t("reminders.add")}
        options={options}
        onValueChange={(v) => {
          if (v === "custom") setCustom(true);
          else if (v !== "") onChange(addReminder(value, Number(v)));
        }}
      />
      {custom ? (
        <div className="flex flex-wrap items-center gap-2 rounded-ui border border-border p-2">
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            aria-label={t("reminders.amount")}
            aria-invalid={invalid || undefined}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-24"
          />
          <div className="w-32">
            <Select
              aria-label={t("reminders.unit")}
              value={unit}
              options={UNITS.map((u) => ({ value: u, label: t(`unit.${u}`) }))}
              onValueChange={setUnit}
            />
          </div>
          <Button size="sm" onClick={addCustom}>
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
