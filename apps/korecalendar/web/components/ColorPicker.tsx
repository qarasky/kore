"use client";

import { Input } from "@qarasky/kore-ui";
import { Check } from "lucide-react";
import { useState } from "react";
import { CALENDAR_COLORS, isHexColor } from "@/lib/colors";
import { t } from "@/lib/i18n";

/**
 * The calendar colours as swatches, plus a hex field for any other. Calendar-specific: the
 * swatches are the colours themselves, so this composes kore-ui's Input with local swatches.
 */
export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
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
              className="grid size-control-sm place-items-center rounded-full text-white"
              style={{ backgroundColor: c }}
            >
              {selected ? <Check size={16} strokeWidth={3} /> : null}
            </button>
          );
        })}
      </div>
      <Input
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
        className="w-28 font-mono"
      />
    </div>
  );
}
