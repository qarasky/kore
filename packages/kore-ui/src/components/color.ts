/** True for #rgb or #rrggbb. */
export function isHexColor(value: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

/** #rgb → #rrggbb, lower case. */
export function normalizeHex(value: string): string {
  const v = value.trim().toLowerCase();
  return v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v;
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
