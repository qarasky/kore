import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { productName, type AppNames, type ProductId } from "./apps";

export type AppMarkProps = {
  app: ProductId;
  /** Pixel size; default 1.1em (scales with the text next to it). */
  size?: number | string;
  className?: string;
  /** Accessible name. Omit when the name is shown next to the mark (decorative). */
  title?: string;
};

/* Every mark is drawn in currentColor (accent by default) with Kore's 1 / 0.6 / 0.3 opacity ramp. */
const MARKS: Record<ProductId, ReactNode> = {
  // Kore: a 2×2 tile grid.
  kore: (
    <g fill="currentColor">
      <rect x="0" y="0" width="7" height="7" rx="1.5" />
      <rect x="9" y="0" width="7" height="7" rx="1.5" opacity="0.6" />
      <rect x="0" y="9" width="7" height="7" rx="1.5" opacity="0.6" />
      <rect x="9" y="9" width="7" height="7" rx="1.5" opacity="0.3" />
    </g>
  ),
  // KoreMind: a ring of four arcs.
  koremind: (
    <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
      <path d="M9.6 2.2A6 6 0 0 1 13.8 6.4" />
      <path d="M13.8 9.6A6 6 0 0 1 9.6 13.8" opacity="0.6" />
      <path d="M6.4 13.8A6 6 0 0 1 2.2 9.6" opacity="0.3" />
      <path d="M2.2 6.4A6 6 0 0 1 6.4 2.2" opacity="0.6" />
    </g>
  ),
  // KoreCalendar: a 3×3 grid, today solid, its row and column fading out.
  korecalendar: (
    <g fill="currentColor">
      {[0.3, 0.6, 0.3, 0.6, 1, 0.6, 0.3, 0.6, 0.3].map((o, i) => (
        <rect key={i} x={(i % 3) * 6} y={Math.floor(i / 3) * 6} width="4" height="4" rx="1" opacity={o} />
      ))}
    </g>
  ),
  // KoreMonitor (Flatline): a heartbeat line.
  flatline: (
    <path
      d="M1 8h3.5L6 4.5v7L7.5 8H10l1.5-3.5v7L13 8h2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Kore ID: a solid core inside a ring.
  "kore-id": (
    <g fill="currentColor">
      <path
        d="M8 0.5a7.5 7.5 0 1 1 0 15a7.5 7.5 0 0 1 0-15Zm0 2.2a5.3 5.3 0 1 0 0 10.6a5.3 5.3 0 0 0 0-10.6Z"
        opacity="0.45"
      />
      <circle cx="8" cy="8" r="3" />
    </g>
  ),
};

/** The mark of a Kore product (accent-coloured; set `className="text-…"` to recolour). */
export function AppMark({ app, size = "1.1em", className, title }: AppMarkProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0 text-accent", className)}
    >
      {MARKS[app]}
    </svg>
  );
}

export type WordmarkProps = {
  app?: ProductId;
  /** Display-name overrides. */
  names?: AppNames;
  className?: string;
};

/** Mark + product name, semibold with tight tracking. Size it with a text class (`text-brand`, `text-display`). */
export function Wordmark({ app = "kore", names, className }: WordmarkProps) {
  return (
    <span className={cn("inline-flex items-center gap-2 select-none", className)}>
      <AppMark app={app} />
      <span className="font-semibold tracking-[-0.03em]">{productName(app, names)}</span>
    </span>
  );
}

/** The Kore wordmark (`<Wordmark app="kore" />`). Pass `app` for another product's. */
export function KoreLogo(props: WordmarkProps) {
  return <Wordmark {...props} />;
}
