"use client";

import { Button, CopyField, Dialog, DialogBody, DialogContent, DialogFooter } from "@qarasky/kore-ui";

/**
 * A freshly issued backup-agent token, shown once. Closing the dialog drops
 * it: nothing keeps it, and no endpoint returns it again.
 */
export function TokenDialog({ agentName, token, onClose }: { agentName: string; token: string; onClose: () => void }) {
    return (
        // Only Done closes it: a stray click or Esc must not lose a token shown once.
        <Dialog open>
            <DialogContent
                title={`Token for “${agentName}”`}
                description="Put it in the agent's token file now. It is shown only this once; rotate the token to get a new one."
                size="lg"
                showClose={false}
                onInteractOutside={(event) => event.preventDefault()}
                onEscapeKeyDown={(event) => event.preventDefault()}
            >
                <DialogBody className="grid gap-2">
                    {/* The clipboard API needs a secure origin; on plain http the field is there to select. */}
                    <CopyField mono value={token} aria-label="Backup agent token" copy={{ label: "Copy token" }} />
                    <p className="text-meta text-muted">
                        It only opens <code>/api/backup/v1</code>; the operator API and the web app refuse it.
                    </p>
                </DialogBody>
                <DialogFooter>
                    <Button variant="primary" onClick={onClose}>
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
