"use client";

import { Combobox } from "@qarasky/kore-ui";
import { useMemo } from "react";
import { t } from "@/lib/i18n";
import { zoneOptions } from "@/lib/zones";

/** A time zone picker (kore-ui Combobox): every IANA zone, searchable, with its current offset. */
export function TimezoneSelect({ value, onChange, id, ariaLabel }: { value: string; onChange: (tz: string) => void; id?: string; ariaLabel?: string }) {
  const options = useMemo(() => zoneOptions([value]), [value]);
  return (
    <Combobox
      id={id}
      aria-label={ariaLabel}
      value={value}
      options={options}
      onValueChange={onChange}
      searchPlaceholder={t("tz.search")}
      emptyText={t("tz.none")}
    />
  );
}
