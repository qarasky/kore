import { Button, EmptyState, Skeleton } from "@qarasky/kore-ui";

/** Static placeholder while the roster loads: no pulse on a screen that is watched all day. */
export function BoardSkeleton({ rows = 8 }: { rows?: number }) {
    return (
        <div aria-busy="true" aria-label="Loading monitors" role="status" className="py-1">
            {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="flex h-11 items-center gap-4 px-4">
                    <Skeleton pulse={false} className="size-3 rounded-full" />
                    <Skeleton pulse={false} className="h-3" style={{ width: `${160 + ((i * 53) % 120)}px` }} />
                    <Skeleton pulse={false} className="ml-auto hidden h-4 w-56 md:block" />
                    <Skeleton pulse={false} className="h-3 w-12" />
                </div>
            ))}
            <span className="sr-only">Loading monitors…</span>
        </div>
    );
}

export function EmptyBoard({ onNewMonitor }: { onNewMonitor: () => void }) {
    return (
        <EmptyState
            className="py-16"
            title="No monitors yet"
            description="Add an HTTP, ping or push monitor, or a group to organise them."
            action={
                <Button variant="primary" onClick={onNewMonitor}>
                    New monitor
                </Button>
            }
        />
    );
}

export function NoMatches({ onClear }: { onClear: () => void }) {
    return (
        <EmptyState
            className="py-16"
            title="Nothing matches"
            description="No monitor fits the current search and filters."
            action={
                <Button size="sm" onClick={onClear}>
                    Clear search and filters
                </Button>
            }
        />
    );
}

export function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <EmptyState
            className="py-16"
            title="Couldn't load the monitors"
            description={<span className="text-danger">{message}</span>}
            action={
                <Button size="sm" onClick={onRetry}>
                    Try again
                </Button>
            }
        />
    );
}
