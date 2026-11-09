"use client";

import { Button, Dialog, DialogBody, DialogContent, DialogFooter, Field, Input, Select } from "@qarasky/kore-ui";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

import { EXPIRY_CHOICES, expiresAt, type ExpiryChoice } from "@/lib/token-row";
import { mintToken } from "@/lib/tokens-api";

import { ShownOnceDialog } from "./shown-once-dialog";

/** Mint an operator token with a name and an optional expiry. */
export function MintTokenDialog({ onMinted }: { onMinted: () => void }) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [expiry, setExpiry] = useState<ExpiryChoice>("90d");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [minted, setMinted] = useState<{ name: string; token: string } | null>(null);

    async function submit(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const answer = await mintToken({ name: name.trim(), expires: expiresAt(expiry, Date.now()) });
            setOpen(false);
            setMinted({ name: answer.apiKey.name, token: answer.token });
            onMinted();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't make the token. Try again.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <Button
                size="sm"
                onClick={() => {
                    setName("");
                    setExpiry("90d");
                    setError(null);
                    setOpen(true);
                }}
            >
                <Plus />
                New token
            </Button>
            <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
                <DialogContent
                    title="New operator token"
                    description="For a script, an integration or an AI agent. It can do everything an operator can."
                >
                    <form onSubmit={(e) => void submit(e)} className="flex min-h-0 flex-col">
                        <DialogBody className="flex flex-col gap-4">
                            <Field
                                label="Name"
                                required
                                hint="Say who or what uses it, so you know what breaks if you disable it."
                            >
                                <Input
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Deploy script"
                                    maxLength={255}
                                />
                            </Field>
                            <Field label="Expires">
                                <Select<ExpiryChoice>
                                    value={expiry}
                                    onValueChange={setExpiry}
                                    options={EXPIRY_CHOICES}
                                />
                            </Field>
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
                                {busy ? "Making…" : "Make token"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
            {minted ? (
                <ShownOnceDialog
                    title={`Token “${minted.name}”`}
                    description="Copy it now: it is shown only this once. It can do everything an operator can."
                    fields={[{ label: "Operator token", value: minted.token, copyLabel: "Copy token" }]}
                    footnote="Use it as a bearer token on /api/v1. It can't sign in to the web app."
                    onDone={() => setMinted(null)}
                />
            ) : null}
        </>
    );
}
