/** The four built-in calendar colours (Kore's accent plus three companions). */
export const CALENDAR_COLORS = ["#5b8def", "#7b6cf0", "#4fb286", "#e5a54b"] as const;

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(v: string): boolean {
  return HEX_COLOR.test(v);
}

/** CSS for an event in a calendar's colour: a tinted fill over the panel, a
 *  solid left edge and the colour itself for the time text. */
export function calendarTint(hex: string): { bg: string; edge: string; text: string } {
  const color = isHexColor(hex) ? hex : CALENDAR_COLORS[0];
  return { bg: `color-mix(in srgb, ${color} 24%, var(--color-surface))`, edge: color, text: color };
}
