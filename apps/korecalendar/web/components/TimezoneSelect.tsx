"use client";

import { useMemo } from "react";
import { zoneOptions } from "@/lib/zones";
import { Select } from "./Select";

/** A time zone picker: every IANA zone with its current offset. */
export function TimezoneSelect({ value, onChange, id, ariaLabel }: { value: string; onChange: (tz: string) => void; id?: string; ariaLabel?: string }) {
  const options = useMemo(() => zoneOptions([value]), [value]);
  return <Select id={id} aria-label={ariaLabel} value={value} options={options} onChange={onChange} />;
}
