/**
 * The wall kiosk (`/superboard/kiosk`): what each server tile, the checks
 * strip and the verdict band say. Pure, so the wall's wording is tested.
 *
 * The kiosk is read from across a room and nobody touches it, so it keeps
 * only what someone walking past can act on: is anything down, which server
 * needs a look and why, and the three usage numbers. Everything else lives on
 * the desk board (`/superboard`) and the server page (`/servers/<id>`).
 *
 * Severity and mutes follow the desk card (`FleetCard`) so the two boards
 * never disagree about which server is in trouble.
 */

import type { BackupAgentSummary, MetricsPayload, MonitorSummary, ResolvedMonitorLink } from "./monitor-types";
import {
    ageOf,
    containerIssue,
    fleetAttention,
    isSampleStale,
    parseTimestamp,
    smartWarning,
    updatesStatus,
} from "./fleet-presentation";
import { cardMute } from "./mute";

/** The slice of a board entry the kiosk reads (the board's `FleetServer`). */
export interface KioskServerInput {
    monitor: MonitorSummary;
    time: string;
    metrics: MetricsPayload;
    links?: ResolvedMonitorLink[];
}

export type KioskTone = "down" | "check" | "ok" | "muted";
export type KioskNoteTone = "quiet" | "warn" | "bad";

export interface KioskNote {
    text: string;
    tone: KioskNoteTone;
}

export interface KioskTile {
    id: number;
    name: string;
    tone: KioskTone;
    /** Short word in the tile's corner: OK, DOWN, SITE DOWN, CHECK, MUTED, MAINT. */
    state: string;
    /** Plain sentences, most severe first. Empty for a healthy tile. */
    problems: string[];
    stale: boolean;
    cpu: number | null;
    ram: number | null;
    disk: number | null;
    /** The fullest mount when it is not `/`. */
    diskMount: string | null;
    /** Small facts under the numbers: sites, backups, containers, updates. */
    notes: KioskNote[];
}

/** Usage at or above this is "high" (the desk card's `hot`). */
const HOT = 90;

const BEHIND = new Set(["overdue", "failed"]);

function finite(value: number | undefined | null): number | null {
    return value !== undefined && value !== null && Number.isFinite(value) ? value : null;
}

function plural(count: number, one: string, many = `${one}s`): string {
    return `${count} ${count === 1 ? one : many}`;
}

function lastBackupTime(agent: BackupAgentSummary): string | null {
    const run = agent.lastCompletedRun;
    return run?.exportFinishedAt ?? run?.completedAt ?? null;
}

/**
 * One server tile.
 * @param server Board entry (monitor, latest sample, linked websites)
 * @param backups Backup agents linked to the server
 * @param covered Monitor ids an active mute covers
 * @param now Current time in milliseconds
 */
export function kioskTile(
    server: KioskServerInput,
    backups: BackupAgentSummary[],
    covered: ReadonlySet<number>,
    now: number
): KioskTile {
    const { monitor, metrics, time } = server;
    const links = server.links ?? [];
    const name = monitor.name || metrics.host?.hostname || "Unnamed server";
    const stale = isSampleStale(metrics, time, monitor.interval || 60, now);
    const { containers, issues } = fleetAttention(metrics, time, monitor.interval || 60, now);
    const mute = cardMute(monitor, links, covered);

    const hostDown = monitor.status === 0 && !covered.has(monitor.id);
    const sitesDown = links.filter((link) => link.status === 0 && !covered.has(link.id));
    const sitesPending = links.filter((link) => link.status === 2);
    const agents = backups.filter((agent) => agent.credentialActive).sort((a, b) => a.name.localeCompare(b.name));
    const behind = agents.filter((agent) => BEHIND.has(agent.health));

    const cpu = finite(metrics.cpu?.percent);
    const ram = finite(metrics.mem?.percent);
    const fullest = metrics.disk?.length
        ? metrics.disk.reduce((worst, next) => ((next.percent ?? -1) > (worst.percent ?? -1) ? next : worst))
        : undefined;
    const disk = finite(fullest?.percent);

    // -- problems, most severe first --------------------------------------
    const problems: string[] = [];
    if (hostDown) {
        problems.push("Host down");
    }
    if (sitesDown.length === 1) {
        problems.push(`Website down: ${sitesDown[0].name}`);
    } else if (sitesDown.length > 1) {
        problems.push(`${sitesDown.length} websites down: ${sitesDown.map((link) => link.name).join(", ")}`);
    }
    // A muted host is down by definition, so its silence is not news.
    const ownTrouble = !mute.hostMuted;
    if (ownTrouble && stale && !hostDown) {
        problems.push(`No data for ${ageOf(time, now)}`);
    }
    if (ownTrouble) {
        const failing = containers.filter(containerIssue);
        if (failing.length === 1) {
            const c = failing[0];
            problems.push(
                `Container ${c.name ?? "?"} ${c.health === "unhealthy" ? "unhealthy" : (c.state ?? "failing")}`
            );
        } else if (failing.length > 1) {
            problems.push(`${failing.length} containers failing`);
        }
        if (metrics.dockerError) {
            problems.push("Container check failing");
        }
        const smart = smartWarning(metrics.smart);
        if (smart) {
            problems.push(smart.text);
        }
        const hot = [
            ["CPU", cpu],
            ["RAM", ram],
            [fullest?.mount && fullest.mount !== "/" ? `Disk ${fullest.mount}` : "Disk", disk],
        ] as const;
        for (const [label, value] of hot) {
            if (value !== null && value >= HOT) {
                problems.push(`${label} ${Math.round(value)}%`);
            }
        }
        if (behind.length > 1) {
            problems.push(`${behind.length} backups behind: ${behind.map((agent) => agent.name).join(", ")}`);
        } else if (behind.length === 1) {
            const agent = behind[0];
            const prefix = agents.length > 1 ? `${agent.name} backup` : "Backup";
            const last = lastBackupTime(agent);
            problems.push(
                agent.health === "failed"
                    ? `${prefix} failed`
                    : `${prefix} overdue${last ? ` (${ageOf(last, now)})` : ""}`
            );
        }
        if (monitor.status === 2) {
            problems.push("Host check pending");
        }
        if (sitesPending.length === 1) {
            problems.push(`Website pending: ${sitesPending[0].name}`);
        } else if (sitesPending.length > 1) {
            problems.push(`${sitesPending.length} websites pending`);
        }
    }

    // -- tone and corner word ---------------------------------------------
    // Same rule as the desk card: anything down is red; a fully muted outage
    // is muted; own trouble (stale, containers, usage, backups, pending) is
    // amber. When only a website is muted, the server's own trouble still
    // counts.
    let tone: KioskTone;
    if (hostDown || sitesDown.length > 0) {
        tone = "down";
    } else if (mute.hostMuted) {
        tone = "muted";
    } else if (problems.length > 0) {
        tone = "check";
    } else {
        tone = "ok";
    }
    const state =
        tone === "down"
            ? hostDown
                ? "DOWN"
                : sitesDown.length === 1
                  ? "SITE DOWN"
                  : "SITES DOWN"
            : tone === "muted"
              ? "MUTED"
              : tone === "check"
                ? "CHECK"
                : monitor.status === 3
                  ? "MAINT"
                  : "OK";

    // -- small notes ---------------------------------------------------------
    const notes: KioskNote[] = [];
    if (links.length) {
        const up = links.filter((link) => link.status === 1).length;
        notes.push({ text: `sites ${up}/${links.length}`, tone: sitesDown.length ? "bad" : "quiet" });
    }
    if (agents.length) {
        const enabled = agents.filter((agent) => agent.health !== "disabled");
        if (enabled.length === 0) {
            notes.push({ text: "backups off", tone: "quiet" });
        } else {
            // The oldest last backup speaks for the server: it is the one at
            // risk. An agent that never completed one is counted, not dated.
            const times = enabled.map(lastBackupTime).filter((time): time is string => time !== null);
            const never = enabled.length - times.length;
            const oldest = times.length
                ? times.reduce((a, b) => (parseTimestamp(a) <= parseTimestamp(b) ? a : b))
                : null;
            const word = enabled.length > 1 ? "backups" : "backup";
            notes.push({
                text: oldest
                    ? `${word} ${ageOf(oldest, now)} ago${never ? ` · ${never} never ran` : ""}`
                    : "no backup yet",
                tone: behind.length ? "warn" : "quiet",
            });
        }
    }
    if (containers.length) {
        const running = containers.filter((c) => c.state === "running").length;
        notes.push({ text: `containers ${running}/${containers.length}`, tone: issues > 0 ? "warn" : "quiet" });
    }
    const updates = updatesStatus(metrics.updates);
    if (updates?.tone === "reboot") {
        notes.push({ text: "reboot required", tone: "warn" });
    } else if (updates?.tone === "critical") {
        notes.push({ text: `security updates ${metrics.updates?.security}`, tone: "warn" });
    }

    return {
        id: monitor.id,
        name,
        tone,
        state,
        problems,
        stale,
        cpu,
        ram,
        disk,
        diskMount: fullest?.mount && fullest.mount !== "/" ? fullest.mount : null,
        notes,
    };
}

export interface KioskChip {
    /** Group id, or 0 for checks outside any group. */
    id: number;
    name: string;
    tone: "down" | "pending" | "ok";
    up: number;
    total: number;
    /** Names of unmuted down checks, for the chip and the verdict. */
    down: { id: number; name: string }[];
}

export interface KioskKnownIssue {
    key: string;
    text: string;
    /** When the mute was set, if known. */
    since: string | null;
}

/** Mute timestamp for a covered monitor: its own, else its first subject's. */
function mutedSince(monitor: MonitorSummary, roster: ReadonlyMap<number, MonitorSummary>): string | null {
    if (monitor.mute?.mutedAt) {
        return monitor.mute.mutedAt;
    }
    for (const subject of monitor.mutedBy ?? []) {
        const at = roster.get(subject)?.mute?.mutedAt;
        if (at) {
            return at;
        }
    }
    return null;
}

/** Earliest of two optional timestamps. */
function earliest(a: string | null, b: string | null): string | null {
    if (!a) {
        return b;
    }
    if (!b) {
        return a;
    }
    return parseTimestamp(a) <= parseTimestamp(b) ? a : b;
}

/**
 * The checks strip: every active monitor that is not a server tile or a
 * group, one chip per parent group (the client), plus the muted outages
 * among them as known issues.
 * @param monitors Full roster
 * @param serverIds Monitors already shown as tiles
 * @param covered Monitor ids an active mute covers
 * @param scopeIds The board's group scope, or null for everything
 */
export function kioskChecks(
    monitors: MonitorSummary[],
    serverIds: ReadonlySet<number>,
    covered: ReadonlySet<number>,
    scopeIds: ReadonlySet<number> | null
): { chips: KioskChip[]; known: KioskKnownIssue[] } {
    const roster = new Map(monitors.map((m) => [m.id, m]));
    const checks = monitors.filter(
        (m) =>
            m.type !== "group" &&
            m.active !== false &&
            !serverIds.has(m.id) &&
            (!scopeIds || (m.parent != null && scopeIds.has(m.parent)))
    );

    const byGroup = new Map<number, MonitorSummary[]>();
    for (const check of checks) {
        const key = check.parent != null && roster.get(check.parent)?.type === "group" ? check.parent : 0;
        byGroup.set(key, [...(byGroup.get(key) ?? []), check]);
    }

    const chips: KioskChip[] = [];
    const known: KioskKnownIssue[] = [];
    for (const [id, list] of byGroup) {
        const name = id === 0 ? "Other" : (roster.get(id)?.name ?? "Other");
        const down = list
            .filter((m) => m.status === 0 && !covered.has(m.id))
            .map((m) => ({ id: m.id, name: m.name }))
            .sort((a, b) => a.name.localeCompare(b.name));
        const pending = list.some((m) => m.status === 2);
        chips.push({
            id,
            name,
            tone: down.length ? "down" : pending ? "pending" : "ok",
            up: list.filter((m) => m.status === 1).length,
            total: list.length,
            down,
        });

        const mutedDown = list.filter((m) => m.status === 0 && covered.has(m.id));
        if (mutedDown.length) {
            const since = mutedDown.reduce<string | null>((at, m) => earliest(at, mutedSince(m, roster)), null);
            known.push({
                key: `group-${id}`,
                text:
                    mutedDown.length === 1
                        ? `${name}: ${mutedDown[0].name} down`
                        : `${name}: ${plural(mutedDown.length, "check")} down`,
                since,
            });
        }
    }

    // The operator's order: group weight, then name; ungrouped checks last.
    const weight = (id: number) => roster.get(id)?.weight ?? 0;
    chips.sort(
        (a, b) => Number(a.id === 0) - Number(b.id === 0) || weight(a.id) - weight(b.id) || a.name.localeCompare(b.name)
    );
    known.sort((a, b) => a.text.localeCompare(b.text));
    return { chips, known };
}

/** Muted host outages, for the known-issues line. */
export function kioskMutedHosts(tiles: KioskTile[], monitors: ReadonlyMap<number, MonitorSummary>): KioskKnownIssue[] {
    return tiles
        .filter((tile) => tile.tone === "muted")
        .map((tile) => {
            const monitor = monitors.get(tile.id);
            return {
                key: `host-${tile.id}`,
                text: `${tile.name}: host down`,
                since: monitor ? mutedSince(monitor, monitors) : null,
            };
        });
}

/** "a, b, c +2": the band has room for three names. */
function firstNames(names: string[]): string {
    return `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}`;
}

export interface KioskVerdict {
    tone: "down" | "check" | "ok";
    text: string;
    detail: string;
}

/**
 * The band's one sentence. Down beats "needs a look"; a website that is both
 * a tile's link and a chip's check is counted once.
 */
export function kioskVerdict(tiles: KioskTile[], chips: KioskChip[], muted: number): KioskVerdict {
    const downHosts = tiles.filter((tile) => tile.state === "DOWN");
    const downChecks = new Map<number, string>();
    for (const chip of chips) {
        for (const check of chip.down) {
            downChecks.set(check.id, check.name);
        }
    }
    const checking = tiles.filter((tile) => tile.tone === "check");
    // Site-down tiles whose sites are not on the strip (a scoped board).
    const siteTiles = tiles.filter((tile) => tile.tone === "down" && tile.state !== "DOWN");

    const ok = tiles.filter((tile) => tile.tone === "ok").length;
    const checksUp = chips.reduce((sum, chip) => sum + chip.up, 0);
    const checksTotal = chips.reduce((sum, chip) => sum + chip.total, 0);
    const detail = [
        `${ok}/${plural(tiles.length, "server")} OK`,
        checksTotal ? `${checksUp}/${plural(checksTotal, "check")} up` : null,
        muted ? `${muted} muted` : null,
    ]
        .filter(Boolean)
        .join(" · ");

    const downNames = [...downHosts.map((tile) => tile.name), ...downChecks.values()];
    if (downNames.length === 0 && siteTiles.length) {
        downNames.push(...siteTiles.map((tile) => `${tile.name} sites`));
    }
    if (downNames.length === 1) {
        return { tone: "down", text: `${downNames[0]} is down`, detail };
    }
    if (downNames.length > 1) {
        return { tone: "down", text: `${downNames.length} down: ${firstNames(downNames)}`, detail };
    }
    if (checking.length === 1) {
        return { tone: "check", text: `${checking[0].name}: ${checking[0].problems[0]}`, detail };
    }
    if (checking.length > 1) {
        return {
            tone: "check",
            text: `${checking.length} servers need a look: ${firstNames(checking.map((tile) => tile.name))}`,
            detail,
        };
    }
    if (chips.some((chip) => chip.tone === "pending")) {
        return { tone: "check", text: "Some checks are pending", detail };
    }
    return { tone: "ok", text: "All systems OK", detail };
}

export interface KioskGrid {
    cols: number;
    rows: number;
    /** Tiles per page; less than the fleet only when they cannot fit. */
    perPage: number;
}

/** A tile's comfortable size, in board units (one unit is about 19 px on a 1080p wall). */
const TILE_W = 24;
const TILE_H = 18;
/** Below this fraction of the comfortable size a tile is unreadable: paginate. */
const MIN_SCALE = 0.7;

/**
 * Columns and rows that make `count` tiles as large as possible inside the
 * grid area, keeping their shape near TILE_W:TILE_H. When even the best
 * arrangement shrinks tiles below MIN_SCALE, fewer tiles go on each page.
 * @param count Tiles to place
 * @param width Grid area width in px
 * @param height Grid area height in px
 * @param unit One board unit in px
 * @param gap Gap between tiles in px
 */
export function kioskGrid(count: number, width: number, height: number, unit: number, gap: number): KioskGrid {
    if (count <= 0 || width <= 0 || height <= 0 || unit <= 0) {
        return { cols: 1, rows: 1, perPage: Math.max(1, count) };
    }
    const scaleFor = (n: number, cols: number) => {
        const rows = Math.ceil(n / cols);
        const w = (width - gap * (cols - 1)) / cols;
        const h = (height - gap * (rows - 1)) / rows;
        return Math.min(w / (TILE_W * unit), h / (TILE_H * unit));
    };
    // Empty cells read as a missing server, so a full arrangement wins over
    // a slightly larger one with holes.
    const best = (n: number) => {
        let pick = { cols: 1, scale: -Infinity, score: -Infinity };
        for (let cols = 1; cols <= n; cols++) {
            const scale = scaleFor(n, cols);
            const score = scale * Math.sqrt(n / (cols * Math.ceil(n / cols)));
            if (score > pick.score) {
                pick = { cols, scale, score };
            }
        }
        return pick;
    };

    let perPage = count;
    let pick = best(perPage);
    while (pick.scale < MIN_SCALE && perPage > 1) {
        perPage -= 1;
        pick = best(perPage);
    }
    return { cols: pick.cols, rows: Math.ceil(perPage / pick.cols), perPage };
}
