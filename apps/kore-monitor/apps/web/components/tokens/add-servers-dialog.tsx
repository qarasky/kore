"use client";

import {
    Button,
    Dialog,
    DialogBody,
    DialogContent,
    DialogFooter,
    Field,
    Input,
    RadioGroup,
    RadioGroupItem,
    Select,
} from "@qarasky/kore-ui";
import { ServerCog } from "lucide-react";
import { useState, type FormEvent } from "react";

import { useBoardData } from "@/components/board/board-data";
import { createMonitor } from "@/lib/monitors-api";
import { installCommand, onboardingLink, onboardingMessage, serverMonitorPayload } from "@/lib/onboarding";
import { EXPIRY_CHOICES, expiresAt, type ExpiryChoice } from "@/lib/token-row";
import { mintToken } from "@/lib/tokens-api";

import { ShownOnceDialog } from "./shown-once-dialog";

type Way = "link" | "myself";

/** Only expiring choices: an onboarding link should stop working on its own. */
const LINK_EXPIRY = EXPIRY_CHOICES.filter((c) => c.value === "7d" || c.value === "30d" || c.value === "90d");

type Result =
    | { kind: "link"; name: string; link: string; message: string }
    | { kind: "myself"; name: string; monitorId: number; command: string };

/**
 * The two ways to add servers. "Send a link" mints an expiring operator token
 * and wraps it in the runbook link, for someone else or their AI agent to
 * onboard any number of servers. "Install it myself" makes one server's push
 * monitor and hands back its install command.
 */
export function AddServersDialog({ onTokenMinted }: { onTokenMinted?: () => void }) {
    const { reload } = useBoardData();
    const [open, setOpen] = useState(false);
    const [way, setWay] = useState<Way>("link");
    const [name, setName] = useState("");
    const [expiry, setExpiry] = useState<ExpiryChoice>("30d");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<Result | null>(null);

    function start() {
        setWay("link");
        setName("");
        setExpiry("30d");
        setError(null);
        setOpen(true);
    }

    async function submit(event: FormEvent) {
        event.preventDefault();
        const label = name.trim();
        setBusy(true);
        setError(null);
        const origin = window.location.origin;
        try {
            if (way === "link") {
                const expires = expiresAt(expiry, Date.now());
                const answer = await mintToken({ name: `Onboarding: ${label}`, expires });
                const link = onboardingLink(origin, answer.token);
                const until = expires ? expires.slice(0, 10) : "never";
                setResult({ kind: "link", name: label, link, message: onboardingMessage(link, until) });
                onTokenMinted?.();
            } else {
                const answer = await createMonitor(serverMonitorPayload(label));
                const pushToken = (answer.monitor as { pushToken?: string | null }).pushToken;
                if (!pushToken) {
                    throw new Error(`“${label}” was made, but it has no push token. Open it under Servers.`);
                }
                setResult({
                    kind: "myself",
                    name: label,
                    monitorId: answer.monitor.id,
                    command: installCommand(origin, pushToken),
                });
                void reload();
            }
            setOpen(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : "That didn't go through. Try again.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <Button variant="primary" size="sm" onClick={start}>
                <ServerCog />
                Add servers
            </Button>
            <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
                <DialogContent
                    title="Add servers"
                    description="Each server gets its own agent and its own token. Pick who installs it."
                >
                    <form onSubmit={(e) => void submit(e)} className="flex min-h-0 flex-col">
                        <DialogBody className="flex flex-col gap-4">
                            <Field label="Who installs the agent">
                                <RadioGroup value={way} onValueChange={(v) => setWay(v as Way)}>
                                    <RadioGroupItem
                                        value="link"
                                        label="Send a link"
                                        description="For a colleague or their AI agent. One link covers any number of servers and their websites."
                                    />
                                    <RadioGroupItem
                                        value="myself"
                                        label="Install it myself"
                                        description="Adds one server now and gives you the command to run on it."
                                    />
                                </RadioGroup>
                            </Field>
                            {way === "link" ? (
                                <>
                                    <Field
                                        label="Who it's for"
                                        required
                                        hint="Names the operator token inside the link, so you can find and disable it."
                                    >
                                        <Input
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            placeholder="CTO, new servers"
                                            maxLength={200}
                                        />
                                    </Field>
                                    <Field label="Link works for">
                                        <Select<ExpiryChoice>
                                            value={expiry}
                                            onValueChange={setExpiry}
                                            options={LINK_EXPIRY}
                                        />
                                    </Field>
                                </>
                            ) : (
                                <Field label="Server name" required hint="As it should read on the Superboard.">
                                    <Input
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="web-01"
                                        maxLength={150}
                                    />
                                </Field>
                            )}
                            {error ? (
                                <p role="alert" className="text-meta text-danger">
                                    {error}
                                </p>
                            ) : null}
                        </DialogBody>
                        <DialogFooter>
                            <Button onClick={() => setOpen(false)} disabled={busy}>
                                Cancel
                            </Button>
                            <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
                                {way === "link" ? (busy ? "Making…" : "Make link") : busy ? "Adding…" : "Add server"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
            {result?.kind === "link" ? (
                <ShownOnceDialog
                    title={`Onboarding link for “${result.name}”`}
                    description="Send it through a private channel, not a group chat or a ticket. It is shown only this once."
                    fields={[
                        { label: "Link", value: result.link, copyLabel: "Copy link" },
                        { label: "Message to send", value: result.message, multiline: true, copyLabel: "Copy message" },
                    ]}
                    footnote={
                        <>
                            The link carries an operator token named “Onboarding: {result.name}”. Disable it under
                            Operator tokens once the servers are in.
                        </>
                    }
                    onDone={() => setResult(null)}
                />
            ) : result?.kind === "myself" ? (
                <ShownOnceDialog
                    title={`Install the agent on “${result.name}”`}
                    description="Run this as root on the server. The server shows up once its first report arrives."
                    fields={[
                        { label: "Install command", value: result.command, multiline: true, copyLabel: "Copy command" },
                    ]}
                    footnote="The command carries this server's push token. It can only report this server."
                    onDone={() => setResult(null)}
                />
            ) : null}
        </>
    );
}
