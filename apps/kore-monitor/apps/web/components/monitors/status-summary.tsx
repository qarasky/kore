"use client";

import { ToggleButton, cn } from "@qarasky/kore-ui";

import type { AttentionItem } from "@/lib/attention";
import { STATUS_LABEL, summarySentence } from "@/lib/board-format";
import { STATUS_KEYS, type StatusKey, type Totals } from "@/lib/board-model";

import { StatusDot } from "./status-dot";

const TONE_TEXT = {
    ok: "text-status-up",
    warn: "text-status-warn",
    bad: "text-status-down",
    maint: "text-status-maint",
    quiet: "text-muted",
};
const TONE_DOT: Record<string, StatusKey> = {
    ok: "up",
    warn: "pending",
    bad: "down",
    maint: "maintenance",
    quiet: "paused",
};

/**
 * The fleet state in words, with counts that double as status filters.
 * A burst of status changes says how many changed instead of flashing rows.
 */
export function StatusSummary({
    totals,
    attention,
    active,
    onToggleStatus,
    changed,
}: {
    totals: Totals;
    attention: AttentionItem[];
    active: StatusKey[];
    onToggleStatus: (status: StatusKey) => void;
    /** Monitors that just changed in a burst too big to highlight row by row. */
    changed: number;
}) {
    const summary = summarySentence(totals, attention);
    return (
        <section aria-label="Fleet status" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex min-w-0 items-center gap-2" role="status">
                <StatusDot status={TONE_DOT[summary.tone]} />
                <span className={cn("font-medium", TONE_TEXT[summary.tone])}>{summary.text}</span>
                {changed > 0 ? <span className="text-muted text-meta tabular-nums">{changed} just changed</span> : null}
            </div>
            <div className="flex flex-wrap items-center gap-1">
                {STATUS_KEYS.map((key) => {
                    const count = totals[key];
                    const pressed = active.includes(key);
                    return (
                        <ToggleButton
                            key={key}
                            pressed={pressed}
                            disabled={count === 0 && !pressed}
                            onPressedChange={() => onToggleStatus(key)}
                            className="text-meta gap-1.5 border-transparent px-2 disabled:opacity-40"
                        >
                            <StatusDot status={key} />
                            <span className="text-text font-semibold tabular-nums">{count}</span>
                            <span className="text-muted">{STATUS_LABEL[key].toLowerCase()}</span>
                        </ToggleButton>
                    );
                })}
            </div>
        </section>
    );
}
