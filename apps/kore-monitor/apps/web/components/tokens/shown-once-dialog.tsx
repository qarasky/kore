"use client";

import { Button, CopyButton, Dialog, DialogBody, DialogContent, DialogFooter, Input, Textarea } from "@qarasky/kore-ui";
import type { ReactNode } from "react";

export interface SecretField {
    /** Visible label above the value. */
    label: string;
    value: string;
    /** A command or a note: shown in a monospace text area instead of one line. */
    multiline?: boolean;
    copyLabel: string;
}

/**
 * A secret shown once: only Done closes it, so a stray click or Esc can't lose
 * it, and closing drops it. Every field can be copied, or selected by hand on
 * plain http where the clipboard API is missing.
 */
export function ShownOnceDialog({
    title,
    description,
    fields,
    footnote,
    onDone,
}: {
    title: string;
    description: string;
    fields: SecretField[];
    footnote?: ReactNode;
    onDone: () => void;
}) {
    return (
        <Dialog open>
            <DialogContent
                size="lg"
                title={title}
                description={description}
                showClose={false}
                onInteractOutside={(event) => event.preventDefault()}
                onEscapeKeyDown={(event) => event.preventDefault()}
            >
                <DialogBody className="flex flex-col gap-4">
                    {fields.map((field) => (
                        <div key={field.label} className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-meta font-medium">{field.label}</span>
                                <CopyButton value={field.value} label={field.copyLabel} />
                            </div>
                            {field.multiline ? (
                                <Textarea
                                    readOnly
                                    value={field.value}
                                    aria-label={field.label}
                                    rows={Math.min(8, field.value.split("\n").length + 1)}
                                    className="font-mono text-sub"
                                    onFocus={(e) => e.target.select()}
                                />
                            ) : (
                                <Input
                                    readOnly
                                    value={field.value}
                                    aria-label={field.label}
                                    className="font-mono text-sub"
                                    onFocus={(e) => e.target.select()}
                                />
                            )}
                        </div>
                    ))}
                    {footnote ? <div className="text-meta text-muted">{footnote}</div> : null}
                </DialogBody>
                <DialogFooter>
                    <Button variant="primary" onClick={onDone}>
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
