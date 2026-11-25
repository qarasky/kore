/** True for #rgb or #rrggbb. */
export function isHexColor(value: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

/** #rgb → #rrggbb, lower case. */
export function normalizeHex(value: string): string {
  const v = value.trim().toLowerCase();
  return v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v;
}

/** How an item that carries a user-chosen colour (an event, a label) is drawn on a surface. */
export type Tint = {
  /** A fill: the colour at `strength` over the page surface. Valid as `background`. */
  background: string;
  /** The colour itself, for an edge or a dot. */
  edge: string;
  /** For text on `background`: the colour mixed toward the theme's text colour, so it reads in Light and Dark alike. */
  text: string;
};

/**
 * A tinted fill plus the solid colour, for things that carry their own colour (calendar events, labels, groups).
 * `strength` is the share of the colour in the fill (default 24%). An invalid hex falls back to the accent, so
 * the result is always drawable. The fill and text mix with the theme's own colours (`--color-surface`, `--color-text`), so
 * they follow Color, Light and Dark by themselves and need theme.css on the page.
 */
export function tintOf(hex: string, strength = 0.24): Tint {
  const color = isHexColor(hex) ? normalizeHex(hex) : "var(--color-accent)";
  const pct = Math.round(Math.min(1, Math.max(0, strength)) * 100);
  return {
    background: `color-mix(in srgb, ${color} ${pct}%, var(--color-surface))`,
    edge: color,
    text: `color-mix(in srgb, ${color} 60%, var(--color-text))`,
  };
}

/** Black or white, whichever reads better on `hex` (WCAG relative luminance). */
export function readableOn(hex: string): "#000000" | "#ffffff" {
  if (!isHexColor(hex)) return "#ffffff";
  const h = normalizeHex(hex);
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return l > 0.4 ? "#000000" : "#ffffff";
}
