/**
 * The motion scale from DESIGN.md §2 as plain numbers, for apps that animate with JS (the `motion` library,
 * Web Animations) and must keep to kore-ui's durations and curves. theme.css has the same values as CSS
 * animations; kore-ui itself uses only CSS. No dependency: pure data.
 */

/** Seconds. Entering is slower than leaving; nothing is longer than 250ms. */
export const koreDuration = {
  /** Hover, press, switch thumb, colour changes. */
  feedback: 0.12,
  /** Menus, popovers, selects, tooltips. */
  pop: { in: 0.14, out: 0.1 },
  /** Overlay scrims and plain fades. */
  fade: { in: 0.16, out: 0.12 },
  dialog: { in: 0.22, out: 0.14 },
  /** The mobile drawer and Sheets. */
  drawer: { in: 0.25, out: 0.18 },
  toast: { in: 0.22, out: 0.12 },
  /** Sidebar collapsing to the icon rail. */
  sidebar: 0.2,
  /** A period or view change inside a page (a calendar moving a week). Same pace as the sidebar. */
  view: 0.2,
} as const;

type Bezier = readonly [number, number, number, number];

/** Cubic-bezier control points; `css` is the same curve for a `transition-timing-function`. */
export const koreEase = {
  /** Enter on this. */
  standard: [0.2, 0, 0, 1] as Bezier,
  /** Leave on this. */
  exit: [0.3, 0, 0.8, 0.15] as Bezier,
  css: {
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    exit: "cubic-bezier(0.3, 0, 0.8, 0.15)",
  },
} as const;
