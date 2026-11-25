"use client";

import { Pause, Play, Trash2 } from "lucide-react";

import { Button, SelectionBar as KoreSelectionBar } from "@qarasky/kore-ui";

/** Floats over the list while rows are selected: bulk Pause, Resume, Delete and Clear. */
export function SelectionBar({
    count,
    busy,
    onPause,
    onResume,
    onDelete,
    onClear,
}: {
    count: number;
    busy: boolean;
    onPause: () => void;
    onResume: () => void;
    onDelete: () => void;
    onClear: () => void;
}) {
    return (
        <KoreSelectionBar
            count={count}
            onClear={onClear}
            labels={{ toolbar: "Selected monitors" }}
            actions={
                <>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={onPause}>
                        <Pause />
                        Pause
                    </Button>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={onResume}>
                        <Play />
                        Resume
                    </Button>
                    <Button variant="danger-outline" size="sm" disabled={busy} onClick={onDelete}>
                        <Trash2 />
                        Delete
                    </Button>
                </>
            }
        />
    );
}
