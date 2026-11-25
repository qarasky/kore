import { describe, expect, test } from "vitest";
import {
    kioskChecks,
    kioskGrid,
    kioskMutedHosts,
    kioskTile,
    kioskVerdict,
    type KioskServerInput,
} from "@/lib/kiosk-board";
import type { BackupAgentSummary, MonitorSummary } from "@/lib/monitor-types";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const iso = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();

function monitor(extra: Partial<MonitorSummary> = {}): MonitorSummary {
    return {
        id: 1,
        name: "bakery",
        type: "push",
        url: null,
        status: 1,
        ping: null,
        lastCheck: null,
        lastMessage: null,
        active: true,
        interval: 60,
        uptime24h: null,
        uptime7d: null,
        uptime30d: null,
        mutedBy: [],
        ...extra,
    };
}

function server(extra: Partial<KioskServerInput> = {}, mon: Partial<MonitorSummary> = {}): KioskServerInput {
    return {
        monitor: monitor(mon),
        time: iso(2),
        metrics: {
            sampleInterval: 1,
            cpu: { percent: 34 },
            mem: { percent: 61 },
            disk: [
                { mount: "/", percent: 48 },
                { mount: "/data", percent: 20 },
            ],
        } as KioskServerInput["metrics"],
        links: [],
        ...extra,
    };
}

function agent(extra: Partial<BackupAgentSummary> = {}): BackupAgentSummary {
    return {
        id: "a1",
        name: "bakery",
        monitorId: 1,
        enabled: true,
        credentialActive: true,
        intervalSeconds: 86400,
        retentionCount: 7,
        createdAt: iso(864000),
        health: "healthy",
        lastErrorCode: null,
        latestRun: null,
        lastCompletedRun: {
            completedAt: iso(3 * 3600),
            exportFinishedAt: iso(3 * 3600),
        } as BackupAgentSummary["lastCompletedRun"],
        latestArchiveVerification: null,
        latestRestoreVerification: null,
        reportedVersion: "0.3.4",
        versionReportedAt: null,
        updateStatus: "ok",
        ...extra,
    };
}

const none = new Set<number>();

describe("kioskTile", () => {
    test("a healthy server is OK with its three numbers and quiet notes", () => {
        const tile = kioskTile(server(), [agent()], none, NOW);
        expect(tile.tone).toBe("ok");
        expect(tile.state).toBe("OK");
        expect(tile.problems).toEqual([]);
        expect([tile.cpu, tile.ram, tile.disk, tile.diskMount]).toEqual([34, 61, 48, null]);
        expect(tile.notes).toEqual([{ text: "backup 3h ago", tone: "quiet" }]);
    });

    test("a down website makes the tile red and names the site", () => {
        const links = [
            {
                id: 7,
                name: "bakery.example.com",
                type: "http",
                status: 0,
                ping: null,
                url: null,
                lastCheck: null,
                via: 7,
            },
            {
                id: 8,
                name: "api.bakery.example.com",
                type: "http",
                status: 1,
                ping: null,
                url: null,
                lastCheck: null,
                via: 8,
            },
        ];
        const tile = kioskTile(server({ links }), [], none, NOW);
        expect(tile.tone).toBe("down");
        expect(tile.state).toBe("SITE DOWN");
        expect(tile.problems[0]).toBe("Website down: bakery.example.com");
        expect(tile.notes[0]).toEqual({ text: "sites 1/2", tone: "bad" });
    });

    test("host down outranks everything and is not also called stale", () => {
        const tile = kioskTile(server({ time: iso(3600) }, { status: 0 }), [], none, NOW);
        expect(tile.state).toBe("DOWN");
        expect(tile.problems).toEqual(["Host down"]);
    });

    test("own trouble is amber: high disk and an overdue backup, in that order", () => {
        const s = server();
        s.metrics.disk = [{ mount: "/data", percent: 91.4 }];
        const late = agent({
            health: "overdue",
            lastCompletedRun: { completedAt: iso(40 * 3600) } as BackupAgentSummary["lastCompletedRun"],
        });
        const tile = kioskTile(s, [late], none, NOW);
        expect(tile.tone).toBe("check");
        expect(tile.state).toBe("CHECK");
        expect(tile.problems).toEqual(["Disk /data 91%", "Backup overdue (1d)"]);
        expect(tile.diskMount).toBe("/data");
        expect(tile.notes).toContainEqual({ text: "backup 1d ago", tone: "warn" });
    });

    test("several backups behind collapse into one line; a never-run agent is counted", () => {
        const late = {
            health: "overdue" as const,
            lastCompletedRun: { completedAt: iso(15 * 86400) } as BackupAgentSummary["lastCompletedRun"],
        };
        const tile = kioskTile(
            server(),
            [
                agent({ id: "a", name: "cms", health: "pending", lastCompletedRun: null }),
                agent({ id: "b", name: "portal", ...late }),
                agent({ id: "c", name: "harbor", ...late }),
            ],
            none,
            NOW
        );
        expect(tile.problems).toEqual(["2 backups behind: harbor, portal"]);
        expect(tile.notes).toContainEqual({ text: "backups 15d ago · 1 never ran", tone: "warn" });
    });

    test("stale data is a problem on its own", () => {
        const tile = kioskTile(server({ time: iso(300) }), [], none, NOW);
        expect(tile.tone).toBe("check");
        expect(tile.problems).toEqual(["No data for 5m"]);
        expect(tile.stale).toBe(true);
    });

    test("a muted host-down server is muted, with no problems of its own", () => {
        const tile = kioskTile(server({ time: iso(7200) }, { status: 0, mutedBy: [1] }), [], new Set([1]), NOW);
        expect(tile.tone).toBe("muted");
        expect(tile.state).toBe("MUTED");
        expect(tile.problems).toEqual([]);
    });

    test("a muted website leaves the server's own trouble counting", () => {
        const links = [
            {
                id: 7,
                name: "bakery.example.com",
                type: "http",
                status: 0,
                ping: null,
                url: null,
                lastCheck: null,
                via: 7,
            },
        ];
        const s = server({ links });
        s.metrics.mem = { percent: 95 };
        const tile = kioskTile(s, [], new Set([7]), NOW);
        expect(tile.tone).toBe("check");
        expect(tile.problems).toEqual(["RAM 95%"]);
    });

    test("reboot and security updates are notes, not problems", () => {
        const s = server();
        s.metrics.updates = { total: 10, security: 3, rebootRequired: true };
        const tile = kioskTile(s, [], none, NOW);
        expect(tile.tone).toBe("ok");
        expect(tile.notes).toContainEqual({ text: "reboot required", tone: "warn" });
    });

    test("a failing container is named", () => {
        const s = server();
        s.metrics.docker = [
            { name: "janitor", state: "restarting" },
            { name: "app", state: "running" },
        ] as KioskServerInput["metrics"]["docker"];
        const tile = kioskTile(s, [], none, NOW);
        expect(tile.problems).toEqual(["Container janitor restarting"]);
        expect(tile.notes).toContainEqual({ text: "containers 1/2", tone: "warn" });
    });
});

describe("kioskChecks", () => {
    const roster = [
        monitor({ id: 1, name: "work", type: "group" }),
        monitor({ id: 2, name: "bakery.example.com", type: "group", parent: 1, weight: 2 }),
        monitor({ id: 3, name: "ACME", type: "group", parent: 1, weight: 1 }),
        monitor({ id: 10, name: "bakery", type: "push", parent: 2 }),
        monitor({ id: 11, name: "bakery.example.com", type: "http", parent: 2, status: 0 }),
        monitor({ id: 12, name: "api.bakery.example.com", type: "http", parent: 2 }),
        monitor({ id: 13, name: "acme.example.com", type: "http", parent: 3 }),
        monitor({
            id: 14,
            name: "old.acme.example.com",
            type: "http",
            parent: 3,
            status: 0,
            mutedBy: [14],
            mute: { mutedAt: iso(172800), monitors: [14], hostMuted: false, smartFailed: [], fullMounts: [] },
        }),
        monitor({ id: 15, name: "paused", type: "http", parent: 3, active: false }),
        monitor({ id: 16, name: "loose", type: "ping" }),
    ];

    test("one chip per parent group in weight order, servers and paused checks left out", () => {
        const { chips, known } = kioskChecks(roster, new Set([10]), new Set([14]), null);
        expect(chips.map((c) => [c.name, c.up, c.total, c.tone])).toEqual([
            ["ACME", 1, 2, "ok"],
            ["bakery.example.com", 1, 2, "down"],
            ["Other", 1, 1, "ok"],
        ]);
        expect(chips[1].down).toEqual([{ id: 11, name: "bakery.example.com" }]);
        expect(known).toEqual([{ key: "group-3", text: "ACME: old.acme.example.com down", since: iso(172800) }]);
    });

    test("a scope keeps only checks in the scoped groups", () => {
        const { chips } = kioskChecks(roster, new Set([10]), none, new Set([3]));
        expect(chips.map((c) => c.name)).toEqual(["ACME"]);
    });
});

describe("kioskVerdict", () => {
    const ok = kioskTile(server({}, { id: 2, name: "shop" }), [], none, NOW);

    test("all good", () => {
        const verdict = kioskVerdict([ok], [{ id: 3, name: "ACME", tone: "ok", up: 4, total: 4, down: [] }], 0);
        expect(verdict).toEqual({ tone: "ok", text: "All systems OK", detail: "1/1 server OK · 4/4 checks up" });
    });

    test("a site down on a tile and on the strip is counted once", () => {
        const links = [
            {
                id: 11,
                name: "bakery.example.com",
                type: "http",
                status: 0,
                ping: null,
                url: null,
                lastCheck: null,
                via: 11,
            },
        ];
        const red = kioskTile(server({ links }), [], none, NOW);
        const chips = [
            {
                id: 2,
                name: "bakery.example.com",
                tone: "down" as const,
                up: 1,
                total: 2,
                down: [{ id: 11, name: "bakery.example.com" }],
            },
        ];
        const verdict = kioskVerdict([red, ok], chips, 1);
        expect(verdict.tone).toBe("down");
        expect(verdict.text).toBe("bakery.example.com is down");
        expect(verdict.detail).toBe("1/2 servers OK · 1/2 checks up · 1 muted");
    });

    test("one server needing a look says why", () => {
        const s = server();
        s.metrics.cpu = { percent: 97 };
        const verdict = kioskVerdict([kioskTile(s, [], none, NOW), ok], [], 0);
        expect(verdict).toMatchObject({ tone: "check", text: "bakery: CPU 97%" });
    });
});

test("muted hosts become known issues with their mute time", () => {
    const mon = monitor({
        status: 0,
        mutedBy: [1],
        mute: { mutedAt: iso(3600), monitors: [1], hostMuted: true, smartFailed: [], fullMounts: [] },
    });
    const tile = kioskTile(server({ time: iso(3600) }, mon), [], new Set([1]), NOW);
    expect(kioskMutedHosts([tile], new Map([[1, mon]]))).toEqual([
        { key: "host-1", text: "bakery: host down", since: iso(3600) },
    ]);
});

describe("kioskGrid", () => {
    test("seven servers on a 1080p wall: four columns, two rows, one page", () => {
        expect(kioskGrid(7, 1872, 760, 19, 15)).toEqual({ cols: 4, rows: 2, perPage: 7 });
    });

    test("three servers fill a row", () => {
        expect(kioskGrid(3, 1872, 760, 19, 15)).toMatchObject({ cols: 3, rows: 1, perPage: 3 });
    });

    test("a big fleet paginates instead of shrinking tiles past readability", () => {
        const grid = kioskGrid(40, 1872, 760, 19, 15);
        expect(grid.perPage).toBeLessThan(40);
        expect(grid.cols * grid.rows).toBeGreaterThanOrEqual(grid.perPage);
    });
});
