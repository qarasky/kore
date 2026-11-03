"use client";

import { CopyButton, Input, Select } from "@qarasky/kore-ui";
import { useId } from "react";
import { t } from "@/lib/i18n";
import { SIZE_UNITS, type SizeUnit } from "@/lib/size";

export { PasswordInput } from "../PasswordInput";

// App-specific compositions of kore-ui controls. Put them inside a kore-ui
// `Field`: the text input picks up its label, hint/error and aria-invalid.

/** A number input plus a unit Select (binary units, labelled like the storage meter). */
export function SizeInput({
  label,
  value,
  unit,
  units,
  onChange,
  disabled,
}: {
  /** The field's label, for the unit Select's name ("Unit for …"). */
  label: string;
  value: string;
  unit: SizeUnit;
  units: readonly SizeUnit[];
  onChange: (value: string, unit: SizeUnit) => void;
  disabled?: boolean;
}) {
  const unitId = useId();
  return (
    <div className="flex gap-2">
      <Input
        inputMode="decimal"
        autoComplete="off"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value, unit)}
        className="max-w-[160px]"
      />
      <Select<SizeUnit>
        // Its own id: the Field's id (and label) belong to the number input.
        id={unitId}
        aria-label={t("admin.form.unit", { field: label })}
        value={unit}
        disabled={disabled}
        onValueChange={(u) => onChange(value, u)}
        className="w-[96px]"
        options={units
          .slice()
          .sort((a, b) => SIZE_UNITS[a] - SIZE_UNITS[b])
          .map((u) => ({ value: u, label: u }))}
      />
    </div>
  );
}

/** A one-time password shown after create/reset, with Copy. */
export function OneTimePassword({ value }: { value: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code data-testid="one-time-password" className="rounded-ui border border-border bg-bg px-2.5 py-1.5 font-mono select-all">
        {value}
      </code>
      <CopyButton
        value={value}
        aria-label={t("password.copyLabel")}
        label={t("password.copy")}
        copiedLabel={t("password.copied")}
        failedLabel={t("password.copyFailed")}
      />
    </div>
  );
}
