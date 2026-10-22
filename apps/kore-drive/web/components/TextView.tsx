"use client";

import { memo, useMemo, type CSSProperties } from "react";
import { splitLines } from "@/lib/preview";

const CHUNK_LINES = 200;
const LINE_PX = 20;

/**
 * Plain text in monospace, always as React text nodes (never HTML), with
 * optional line numbers and soft wrap. Up to the 512 KiB preview limit this
 * can be tens of thousands of lines, so lines are grouped into chunks with
 * `content-visibility: auto`: off-screen chunks skip layout and paint.
 * Line numbers come from a `data-n` attribute via CSS `::before`, so they
 * cost no extra DOM nodes and are left out when the text is copied.
 */
export const TextView = memo(function TextView({
  text,
  lineNumbers,
  wrap,
}: {
  text: string;
  lineNumbers: boolean;
  wrap: boolean;
}) {
  const lines = useMemo(() => splitLines(text), [text]);
  const chunks = useMemo(() => {
    const out: { start: number; lines: string[] }[] = [];
    for (let i = 0; i < lines.length; i += CHUNK_LINES) out.push({ start: i, lines: lines.slice(i, i + CHUNK_LINES) });
    return out;
  }, [lines]);
  const gutter = `${String(lines.length).length}ch`;

  const line =
    (wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre") +
    (lineNumbers
      ? " grid grid-cols-[var(--gutter)_minmax(0,1fr)] gap-x-4 before:text-right before:text-muted/70 " +
        "before:select-none before:content-[attr(data-n)]"
      : "");

  return (
    <div
      data-testid="text-view"
      data-line-count={lines.length}
      className={`px-4 py-3 font-mono text-meta leading-[20px] ${wrap ? "" : "min-w-max"}`}
      style={{ "--gutter": gutter } as CSSProperties}
    >
      {chunks.map((c) => (
        <div
          key={c.start}
          style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${c.lines.length * LINE_PX}px` }}
        >
          {c.lines.map((l, i) => (
            <div key={i} data-n={c.start + i + 1} className={`min-h-[20px] ${line}`}>
              {l}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
});
