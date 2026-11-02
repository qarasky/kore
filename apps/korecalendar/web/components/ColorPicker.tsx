"use client";

import { useId, useState } from "react";
import { CALENDAR_COLORS, isHexColor } from "@/lib/colors";
import { t } from "@/lib/i18n";
import { CheckIcon } from "./icons";
import { inputClass } from "./Field";

/** The four calendar colours as a radio group, plus a hex field for any other. */
export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const group = useId();
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label={t("color.custom")} className="flex gap-1.5">
        {CALENDAR_COLORS.map((c) => {
          const selected = value.toLowerCase() === c;
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={t("color.choose", { color: c })}
              onClick={() => {
                setText(c);
                setInvalid(false);
                onChange(c);
              }}
              className="grid size-control-sm place-items-center rounded-full text-white outline-offset-2"
              style={{ backgroundColor: c }}
            >
              {selected ? <CheckIcon size={16} strokeWidth={3} /> : null}
            </button>
          );
        })}
      </div>
      <input
        id={`${group}-hex`}
        aria-label={t("color.custom")}
        placeholder={t("color.customHint")}
        value={text}
        aria-invalid={invalid || undefined}
        spellCheck={false}
        maxLength={7}
        onChange={(e) => {
          const v = e.target.value.trim();
          setText(v);
          const ok = isHexColor(v);
          setInvalid(v !== "" && !ok);
          if (ok) onChange(v.toLowerCase());
        }}
        className={`${inputClass} w-28 font-mono`}
      />
    </div>
  );
}
