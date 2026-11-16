"use client";

import { PointTooltip } from "@qarasky/kore-ui";
import { memo, useId, useState } from "react";

import { bucketRange, bucketSummary } from "@/lib/board-format";
import { bucketInfo, type Strip, type StripBucket } from "@/lib/heartbeat-strip";

function cellKey(cell: StripBucket): string {
    if (!cell) {
        return "none";
    }
    switch (cell[0]) {
        case 0:
            return "down";
        case 2:
            return "pending";
        case 3:
            return "maintenance";
        default:
            return "up";
    }
}

function describe(strip: Strip, name: string): string {
    const failed = strip.cells.reduce((sum, cell) => sum + (cell ? cell[2] : 0), 0);
    const worst = strip.cells.reduce<string>((acc, cell) => {
        const key = cellKey(cell);
        return key === "down" || (key === "pending" && acc !== "down") ? key : acc;
    }, "up");
    if (strip.cells.every((c) => !c)) {
        return `${name}: no checks in the last 24 hours`;
    }
    return `${name}, last 24 hours: ${failed} failed check${failed === 1 ? "" : "s"}, worst status ${worst}`;
}

/** The hovered bucket's time range, check count and failures, next to the pointer. */
function StripTooltip({
    id,
    strip,
    hover,
    now,
}: {
    id: string;
    strip: Strip;
    hover: { index: number; x: number; y: number } | null;
    now: number;
}) {
    const info = hover ? bucketInfo(strip, hover.index) : null;
    return (
        <PointTooltip id={id} point={hover && info ? hover : null}>
            {info ? (
                <>
                    <div className="text-muted tabular-nums">{bucketRange(info, now)}</div>
                    <div className="mt-0.5 font-medium">{bucketSummary(info)}</div>
                </>
            ) : null}
        </PointTooltip>
    );
}

/**
 * The 24 h heartbeat strip: 48 half-hour buckets, each coloured by its worst
 * beat; cell height varies by status too. An empty slot when the backend has
 * no strip for this monitor, so the row layout does not move.
 */
export const HeartbeatStrip = memo(function HeartbeatStrip({
    strip,
    name,
    now,
    calm,
}: {
    strip: Strip | undefined;
    name: string;
    now: number;
    calm: boolean;
}) {
    const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);
    const tooltipId = useId();
    if (!strip) {
        return <div className="board-strip board-strip-cell" aria-hidden />;
    }
    const last = strip.cells.length - 1;
    return (
        <div
            className="board-strip board-strip-cell"
            role="img"
            aria-label={describe(strip, name)}
            aria-describedby={hover ? tooltipId : undefined}
            onPointerMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const index = Math.min(
                    last,
                    Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * strip.cells.length))
                );
                setHover({ index, x: event.clientX, y: event.clientY });
            }}
            onPointerLeave={() => setHover(null)}
        >
            {strip.cells.slice(0, last).map((cell, index) => (
                <span key={index} className="strip-cell" data-s={cellKey(cell)} />
            ))}
            {/* The newest cell fades in once when a live beat changes it; never on a resnapshot (fresh stays 0). */}
            <span
                key={strip.fresh}
                className="strip-cell"
                data-s={cellKey(strip.cells[last])}
                data-fresh={(strip.fresh > 0 && !calm) || undefined}
            />
            <StripTooltip id={tooltipId} strip={strip} hover={hover} now={now} />
        </div>
    );
});
