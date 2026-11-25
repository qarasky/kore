"use client";

import { Button, Dialog, DialogBody, DialogContent, DialogFooter, ThemeSwitcher } from "@qarasky/kore-ui";

/**
 * Appearance: the Color, Light, Dark and System themes. KoreMonitor has no
 * settings page, so the account menu opens this. The choice applies and is
 * remembered on this device at once (kore-ui's `kore-theme` key).
 */
export function AppearanceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent size="lg" title="Appearance" description="Choose how KoreMonitor looks on this device.">
                <DialogBody>
                    <ThemeSwitcher aria-label="Theme" />
                </DialogBody>
                <DialogFooter>
                    <Button variant="primary" onClick={() => onOpenChange(false)}>
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
