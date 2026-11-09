"use client";

import {
    EmptyState,
    IconButton,
    Menu,
    MenuContent,
    MenuItem,
    MenuTrigger,
    SectionHeader,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    TableRowHeader,
} from "@qarasky/kore-ui";
import { ExternalLink, MoreHorizontal, Server, Terminal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useBoardData } from "@/components/board/board-data";
import { StatusDot } from "@/components/monitors/status-dot";
import { STATUS_LABEL } from "@/lib/board-format";
import { statusKeyOf } from "@/lib/board-model";
import { fetchMonitor } from "@/lib/monitors-api";
import { installCommand } from "@/lib/onboarding";

import { ShownOnceDialog } from "./shown-once-dialog";

/**
 * Every server's push token, one per push monitor. The values stay on the
 * server until asked for: "Show install command" reads the monitor and puts
 * its token into the command that installs or reinstalls the agent.
 */
export function ServerTokens() {
    const { monitors, rosterLoaded } = useBoardData();
    const router = useRouter();
    const servers = useMemo(
        () => monitors.filter((m) => m.type === "push").sort((a, b) => a.name.localeCompare(b.name)),
        [monitors]
    );
    const [shown, setShown] = useState<{ name: string; command: string } | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function show(id: number, name: string) {
        setError(null);
        try {
            const { monitor } = await fetchMonitor(id);
            const token = typeof monitor.pushToken === "string" ? monitor.pushToken : null;
            if (!token) {
                setError(`“${name}” has no push token, so there is no install command for it.`);
                return;
            }
            setShown({ name, command: installCommand(window.location.origin, token) });
        } catch (e) {
            setError(e instanceof Error ? e.message : `Couldn't read “${name}”. Try again.`);
        }
    }

    return (
        <section aria-labelledby="server-tokens" className="flex flex-col">
            <SectionHeader
                title={<span id="server-tokens">Server agent tokens</span>}
                description="One per server, made with the server. Each only reports its own server."
            />
            {error ? (
                <p role="alert" className="mb-3 text-meta text-danger">
                    {error}
                </p>
            ) : null}
            {rosterLoaded && servers.length === 0 ? (
                <EmptyState
                    icon={<Server />}
                    title="No servers yet"
                    description="Add a server to get its token and install command."
                />
            ) : (
                <Table caption="Server agent tokens">
                    <TableHeader>
                        <TableRow>
                            <TableHead>Server</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="max-sm:hidden">Token</TableHead>
                            <TableHead className="w-12">
                                <span className="sr-only">Actions</span>
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {servers.map((server) => {
                            const status = statusKeyOf(server);
                            return (
                                <TableRow key={server.id}>
                                    <TableRowHeader>
                                        <Link
                                            href={`/servers/${server.id}`}
                                            className="block max-w-72 truncate font-medium hover:underline"
                                        >
                                            {server.name}
                                        </Link>
                                    </TableRowHeader>
                                    <TableCell>
                                        <span className="inline-flex items-center gap-2">
                                            <StatusDot status={status} />
                                            {STATUS_LABEL[status]}
                                        </span>
                                    </TableCell>
                                    <TableCell muted className="font-mono text-meta max-sm:hidden">
                                        kmon_agent_push_…
                                    </TableCell>
                                    <TableCell align="right">
                                        <Menu>
                                            <MenuTrigger asChild>
                                                <IconButton
                                                    label={`Actions for ${server.name}`}
                                                    icon={<MoreHorizontal />}
                                                />
                                            </MenuTrigger>
                                            <MenuContent align="end">
                                                <MenuItem
                                                    icon={<Terminal />}
                                                    onSelect={() => void show(server.id, server.name)}
                                                >
                                                    Show install command
                                                </MenuItem>
                                                <MenuItem
                                                    icon={<ExternalLink />}
                                                    onSelect={() => router.push(`/servers/${server.id}`)}
                                                >
                                                    Open server
                                                </MenuItem>
                                            </MenuContent>
                                        </Menu>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            )}
            {shown ? (
                <ShownOnceDialog
                    title={`Install the agent on “${shown.name}”`}
                    description="Run this as root on the server. On a server that already has the agent, it keeps the existing config."
                    fields={[
                        { label: "Install command", value: shown.command, multiline: true, copyLabel: "Copy command" },
                    ]}
                    footnote="The command carries this server's push token. Keep it out of chats and tickets."
                    onDone={() => setShown(null)}
                />
            ) : null}
        </section>
    );
}
