"use client";

import {
    Badge,
    EmptyState,
    SectionHeader,
    Table,
    TableBody,
    TableCell,
    TableEmpty,
    TableHead,
    TableHeader,
    TableRow,
    TableRowHeader,
} from "@qarasky/kore-ui";
import { DatabaseBackup } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useBoardData } from "@/components/board/board-data";
import { fetchAllBackupAgents } from "@/lib/monitors-api";
import type { BackupAgentSummary } from "@/lib/monitor-types";

/**
 * Every backup agent's token state. Tokens are rotated and revoked on the
 * agent's own page, where the new value is shown once; this list says which
 * agents hold a live token and links there.
 */
export function BackupTokens() {
    const { monitors } = useBoardData();
    const [agents, setAgents] = useState<BackupAgentSummary[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const names = useMemo(() => new Map(monitors.map((m) => [m.id, m.name])), [monitors]);

    useEffect(() => {
        const abort = new AbortController();
        fetchAllBackupAgents(abort.signal)
            .then((list) => setAgents([...list].sort((a, b) => a.name.localeCompare(b.name))))
            .catch((e: unknown) => {
                if (!abort.signal.aborted) {
                    setError(e instanceof Error ? e.message : "Couldn't load the backup agents. Reload the page.");
                }
            });
        return () => abort.abort();
    }, []);

    return (
        <section aria-labelledby="backup-tokens" className="flex flex-col">
            <SectionHeader
                title={<span id="backup-tokens">Backup agent tokens</span>}
                description="One per backup agent. Rotate or revoke a token on the agent's page under Backups."
            />
            {error ? (
                <p role="alert" className="mb-3 text-meta text-danger">
                    {error}
                </p>
            ) : null}
            {agents !== null && agents.length === 0 ? (
                <EmptyState
                    icon={<DatabaseBackup />}
                    title="No backup agents yet"
                    description="Add one under Backups. Its token is shown once when you make it."
                />
            ) : (
                <Table caption="Backup agent tokens">
                    <TableHeader>
                        <TableRow>
                            <TableHead>Backup agent</TableHead>
                            <TableHead>Token</TableHead>
                            <TableHead className="max-sm:hidden">Server</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {agents === null ? (
                            <TableEmpty colSpan={3}>Loading…</TableEmpty>
                        ) : (
                            agents.map((agent) => (
                                <TableRow key={agent.id}>
                                    <TableRowHeader>
                                        <Link
                                            href={`/backups/${encodeURIComponent(agent.id)}`}
                                            className="block max-w-72 truncate font-medium hover:underline"
                                        >
                                            {agent.name}
                                        </Link>
                                    </TableRowHeader>
                                    <TableCell>
                                        {agent.credentialActive ? (
                                            <Badge tone="success">Active</Badge>
                                        ) : (
                                            <Badge tone="warning">Revoked</Badge>
                                        )}
                                    </TableCell>
                                    <TableCell muted className="max-sm:hidden">
                                        {agent.monitorId === null ? "—" : (names.get(agent.monitorId) ?? "—")}
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            )}
        </section>
    );
}
