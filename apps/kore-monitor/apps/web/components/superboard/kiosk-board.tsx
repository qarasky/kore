"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BackupAgentSummary, MonitorSummary } from "@/lib/monitor-types";
import { ageOf, parseTimestamp } from "@/lib/fleet-presentation";
import {
    kioskChecks,
    kioskGrid,
    kioskMutedHosts,
    kioskTile,
    kioskVerdict,
    type KioskGrid,
    type KioskTile,
} from "@/lib/kiosk-board";
import type { FleetServer } from "./fleet-card";

/** Live data may be missing this long before the wall dims (one reconnect cycle). */
const OFFLINE_AFTER_MS = 20_000;

/** Problems a tile lists before "+N more" (the server page has the rest). */
const PROBLEM_LINES = 3;

/** 24-hour wall time, whatever the browser locale. */
const WALL_TIME: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };

/** One board unit in px, the same formula as `--u` in globals.css. */
function boardUnit(): number {
    return Math.min(40, Math.max(9, Math.min(window.innerWidth / 100, window.innerHeight * 0.018)));
}

function useSecondTick(): number {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const timer = window.setInterval(() => {
            if (!document.hidden) {
                setNow(Date.now());
            }
        }, 1000);
        return () => window.clearInterval(timer);
    }, []);
    return now;
}

/** Clock and freshness, the only per-second text on the wall. */
function BandClock({ newest, offline }: { newest: string | null; offline: boolean }) {
    const now = useSecondTick();
    return (
        <div className="kiosk-band-right">
            <div className="kiosk-clock tnum">{new Date(now).toLocaleTimeString([], WALL_TIME)}</div>
            <div className="kiosk-live tnum" data-offline={offline || undefined}>
                <span aria-hidden="true">●</span> {offline ? "Reconnecting" : "Live"}
                {newest ? ` · updated ${ageOf(newest, now)} ago` : ""}
            </div>
        </div>
    );
}

function Meter({ label, value }: { label: string; value: number | null }) {
    const shown = value === null ? null : Math.round(value);
    return (
        <div className="kiosk-meter">
            <div className="kiosk-meter-label">{label}</div>
            <div className="kiosk-meter-value tnum">
                {shown === null ? "—" : shown}
                {shown === null ? null : <small>%</small>}
            </div>
            <div className="kiosk-meter-track" aria-hidden="true">
                <i
                    style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }}
                    data-hot={value !== null && value >= 90 ? true : undefined}
                />
            </div>
        </div>
    );
}

function Tile({ tile }: { tile: KioskTile }) {
    return (
        <article
            className="kiosk-tile"
            data-tone={tile.tone}
            data-stale={tile.stale || undefined}
            aria-label={`${tile.name}: ${tile.state}${tile.problems.length ? `, ${tile.problems.join(", ")}` : ""}`}
        >
            <div className="kiosk-tile-body">
                <header className="kiosk-tile-head">
                    <h2 className="kiosk-tile-name">{tile.name}</h2>
                    <span className="kiosk-tile-state">{tile.state}</span>
                </header>
                {tile.problems.length ? (
                    <ul className="kiosk-tile-problems">
                        {tile.problems.slice(0, PROBLEM_LINES).map((problem) => (
                            <li key={problem}>{problem}</li>
                        ))}
                        {tile.problems.length > PROBLEM_LINES ? (
                            <li className="kiosk-tile-more">+{tile.problems.length - PROBLEM_LINES} more</li>
                        ) : null}
                    </ul>
                ) : null}
                <div className="kiosk-meters">
                    <Meter label="CPU" value={tile.cpu} />
                    <Meter label="RAM" value={tile.ram} />
                    <Meter label={tile.diskMount ? `DISK ${tile.diskMount}` : "DISK"} value={tile.disk} />
                </div>
                {tile.notes.length ? (
                    <p className="kiosk-tile-notes">
                        {tile.notes.map((note) => (
                            <span key={note.text} data-tone={note.tone}>
                                {note.text}
                            </span>
                        ))}
                    </p>
                ) : null}
            </div>
        </article>
    );
}

/**
 * The wall kiosk: a verdict band, one tile per server sized to fill the
 * screen, a strip of the other checks by client group, and muted outages as
 * a quiet line. Display-only: no menus, dialogs or pause-on-touch. When live
 * data stops, the whole board dims and says since when.
 */
export function KioskBoard({
    servers,
    backups,
    covered,
    roster,
    scopeIds,
    scopeTitle,
    now,
    loaded,
    liveLostAt,
    rotateMs,
}: {
    servers: FleetServer[];
    backups: Map<number, BackupAgentSummary[]>;
    covered: ReadonlySet<number>;
    roster: MonitorSummary[];
    scopeIds: ReadonlySet<number> | null;
    scopeTitle: string | null;
    now: number;
    /** The first snapshot has arrived; before it the band says so instead of "All systems OK". */
    loaded: boolean;
    /** When the live stream last failed, cleared on the next good update. */
    liveLostAt: number | null;
    rotateMs: number;
}) {
    const tiles = useMemo(
        () => servers.map((server) => kioskTile(server, backups.get(server.monitor.id) ?? [], covered, now)),
        [servers, backups, covered, now]
    );
    const rosterById = useMemo(() => new Map(roster.map((m) => [m.id, m])), [roster]);
    const { chips, known: knownChecks } = useMemo(
        () => kioskChecks(roster, new Set(servers.map((s) => s.monitor.id)), covered, scopeIds),
        [roster, servers, covered, scopeIds]
    );
    const known = [...kioskMutedHosts(tiles, rosterById), ...knownChecks];
    const verdict = loaded
        ? kioskVerdict(tiles, chips, known.length)
        : { tone: "idle" as const, text: "Connecting…", detail: "Waiting for the first readings" };

    const newest = servers.reduce<string | null>(
        (latest, s) => (!latest || parseTimestamp(s.time) > parseTimestamp(latest) ? s.time : latest),
        null
    );
    // Every server silent at once means the board is not receiving, not that
    // the whole fleet died; one silent server is just that server's problem.
    const allStale = tiles.length > 1 && tiles.every((tile) => tile.stale);
    const offline = (liveLostAt !== null && now - liveLostAt >= OFFLINE_AFTER_MS) || allStale;

    // -- fit the tiles to the screen -------------------------------------------
    const gridRef = useRef<HTMLDivElement>(null);
    const [grid, setGrid] = useState<KioskGrid>({ cols: 4, rows: 2, perPage: Math.max(1, tiles.length) });
    useEffect(() => {
        const el = gridRef.current;
        if (!el) {
            return;
        }
        const measure = () => {
            const unit = boardUnit();
            const next = kioskGrid(tiles.length, el.clientWidth, el.clientHeight, unit, unit * 0.8);
            setGrid((prev) =>
                prev.cols === next.cols && prev.rows === next.rows && prev.perPage === next.perPage ? prev : next
            );
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [tiles.length]);

    // Rotation only when the fleet cannot fit; the wall never needs a touch.
    const pageCount = Math.max(1, Math.ceil(tiles.length / grid.perPage));
    const [page, setPage] = useState(0);
    useEffect(() => {
        if (page >= pageCount) {
            setPage(0);
        }
    }, [page, pageCount]);
    useEffect(() => {
        if (pageCount <= 1) {
            return;
        }
        const timer = window.setInterval(() => {
            if (!document.hidden) {
                setPage((p) => (p + 1) % pageCount);
            }
        }, rotateMs);
        return () => window.clearInterval(timer);
    }, [pageCount, rotateMs]);
    const pageTiles = tiles.slice(page * grid.perPage, (page + 1) * grid.perPage);

    return (
        <div className="kiosk" data-offline={offline || undefined}>
            <section className="kiosk-band" data-tone={verdict.tone} aria-live="polite">
                <span className="kiosk-band-dot" aria-hidden="true" />
                <div className="min-w-0">
                    <div className="kiosk-verdict">{verdict.text}</div>
                    <div className="kiosk-detail tnum">
                        {scopeTitle ? `${scopeTitle} · ` : ""}
                        {verdict.detail}
                        {pageCount > 1 ? ` · page ${page + 1}/${pageCount}` : ""}
                    </div>
                </div>
                <BandClock newest={newest} offline={offline} />
            </section>

            <div
                ref={gridRef}
                className="kiosk-grid"
                style={{
                    gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
                }}
            >
                {pageTiles.map((tile) => (
                    <Tile key={tile.id} tile={tile} />
                ))}
            </div>

            {chips.length ? (
                <section className="kiosk-strip" aria-label="Checks by group">
                    <span className="kiosk-strip-title">CHECKS</span>
                    {chips.map((chip) => (
                        <span key={chip.id} className="kiosk-chip" data-tone={chip.tone}>
                            <span className="kiosk-chip-dot" aria-hidden="true" />
                            {chip.name}
                            <span className="kiosk-chip-count tnum">
                                {chip.up}/{chip.total}
                            </span>
                            {chip.down.length ? (
                                <b className="kiosk-chip-down">
                                    {chip.down
                                        .slice(0, 2)
                                        .map((check) => check.name)
                                        .join(", ")}
                                    {chip.down.length > 2 ? ` +${chip.down.length - 2}` : ""}
                                </b>
                            ) : null}
                        </span>
                    ))}
                </section>
            ) : null}

            {known.length ? (
                <section className="kiosk-known" aria-label="Known issues, muted">
                    <span className="kiosk-strip-title">KNOWN · MUTED</span>
                    {known.map((issue) => (
                        <span key={issue.key} className="kiosk-known-item">
                            {issue.text}
                            {issue.since ? ` · muted ${ageOf(issue.since, now)} ago` : ""}
                        </span>
                    ))}
                </section>
            ) : null}

            {offline ? (
                <div className="kiosk-offline" role="alert">
                    <div className="kiosk-offline-panel">
                        <div className="kiosk-offline-title">No live data</div>
                        <div className="kiosk-offline-detail tnum">
                            {newest
                                ? `Last reading at ${new Date(parseTimestamp(newest)).toLocaleTimeString([], WALL_TIME)} (${ageOf(newest, now)} ago)`
                                : "Waiting for the first reading"}
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
