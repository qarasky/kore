"use client";

import { Alert, Button } from "@qarasky/kore-ui";

import { useBoardData } from "./board-data";

/**
 * Says that live updates are paused (Pause on Monitors holds the whole
 * admin area's roster) and offers Resume, on every page that shows status.
 */
export function PausedBanner() {
    const { paused, pending, setPaused } = useBoardData();
    if (!paused) {
        return null;
    }
    return (
        <Alert
            banner
            tone="warning"
            className="shrink-0"
            title="Live updates paused"
            action={
                <Button size="sm" onClick={() => setPaused(false)}>
                    Resume
                </Button>
            }
        >
            {pending > 0 ? <span className="tabular-nums">{pending} waiting</span> : null}
        </Alert>
    );
}
