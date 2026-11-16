"use client";

import { RadioGroup as RadixRadioGroup } from "radix-ui";
import type { CSSProperties } from "react";
import { cn } from "../lib/cn";
import { useTheme } from "../lib/ThemeProvider";
import { KORE_THEMES, THEME_IDS, type ThemeId, type ThemePreference } from "../lib/theme";

const DEFAULT_LABELS: Record<ThemePreference, { name: string; description: string }> = {
  color: { name: "Color", description: "The original blue-grey dark look" },
  light: { name: "Light", description: "White surfaces, the same accent" },
  dark: { name: "Dark", description: "Pure black, for OLED screens" },
  system: { name: "System", description: "Match this device" },
};

export type ThemeSwitcherProps = {
  /** Offer "System" (follow the OS). Default true. */
  includeSystem?: boolean;
  /** Names and one-line descriptions, for translation. Defaults are English. */
  labels?: Partial<Record<ThemePreference, { name: string; description?: string }>>;
  /** Accessible name of the group. Default "Theme". */
  "aria-label"?: string;
  className?: string;
};

/** A tiny window drawn in a theme's own colours, so a tile shows its theme whatever the page uses now. */
function Preview({ id }: { id: ThemeId }) {
  const p = KORE_THEMES[id];
  const line = (width: string, color: string, opacity = 1): CSSProperties => ({ width, height: 5, borderRadius: 3, background: color, opacity });
  return (
    <span aria-hidden="true" className="block h-[68px] w-full overflow-hidden" style={{ background: p.bg }}>
      <span
        className="m-2 flex h-[calc(100%-16px)] flex-col gap-1.5 rounded-[4px] p-2"
        style={{ background: p.surface, border: `1px solid ${p.border}` }}
      >
        <span style={line("46%", p.text, 0.85)} />
        <span style={line("72%", p.muted)} />
        <span className="mt-auto flex gap-1.5">
          <span style={{ ...line("28px", p.accent), height: 8 }} />
          <span style={{ ...line("20px", p.borderStrong), height: 8 }} />
        </span>
      </span>
    </span>
  );
}

function SystemPreview() {
  return (
    <span aria-hidden="true" className="relative block h-[68px] w-full overflow-hidden">
      <span className="absolute inset-0">
        <Preview id="light" />
      </span>
      <span className="absolute inset-0" style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}>
        <Preview id="color" />
      </span>
    </span>
  );
}

/**
 * Pick the theme: Color, Light, Dark (pure black), and optionally System. A radio group of tiles for a settings
 * page ("Appearance"); arrows move and select, the choice applies at once and is remembered (see `ThemeProvider`).
 */
export function ThemeSwitcher({ includeSystem = true, labels, "aria-label": ariaLabel = "Theme", className }: ThemeSwitcherProps) {
  const { preference, setTheme } = useTheme();
  const options: ThemePreference[] = [...THEME_IDS, ...(includeSystem ? (["system"] as const) : [])];
  return (
    <RadixRadioGroup.Root
      aria-label={ariaLabel}
      value={preference}
      onValueChange={(value) => setTheme(value as ThemePreference)}
      className={cn("grid grid-cols-2 gap-3 sm:grid-cols-4", className)}
    >
      {options.map((option) => {
        const text = { ...DEFAULT_LABELS[option], ...labels?.[option] };
        return (
          <RadixRadioGroup.Item
            key={option}
            value={option}
            className={cn(
              "group flex flex-col overflow-hidden rounded-ui border border-border-strong bg-surface text-left transition-colors",
              "hover:border-muted data-[state=checked]:border-accent data-[state=checked]:ring-2 data-[state=checked]:ring-accent/30",
            )}
          >
            {option === "system" ? <SystemPreview /> : <Preview id={option} />}
            <span className="flex flex-col px-3 py-2">
              <span className="font-medium">{text.name}</span>
              {text.description ? <span className="text-meta text-muted">{text.description}</span> : null}
            </span>
          </RadixRadioGroup.Item>
        );
      })}
    </RadixRadioGroup.Root>
  );
}
