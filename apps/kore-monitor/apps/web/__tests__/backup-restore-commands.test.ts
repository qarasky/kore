import { describe, expect, it } from "vitest";

import { backupFileName, backupRestoreCommands } from "@/lib/backup-presentation";
import type { BackupRunSummary } from "@/lib/monitor-types";

function run(encrypted: boolean | undefined): BackupRunSummary {
    return {
        id: "fa129fdc-8894-498f-b845-30fe7dd1fa0b",
        sourceSummary: encrypted === undefined ? null : { encrypted, databaseCount: 1, objectCount: 0, sourceBytes: 0 },
    } as unknown as BackupRunSummary;
}

describe("backupRestoreCommands", () => {
    it("names the downloaded plain bundle and needs no identity file", () => {
        const text = backupRestoreCommands(run(false));
        const file = "flatline-backup-fa129fdc-8894-498f-b845-30fe7dd1fa0b.tar";
        expect(backupFileName(run(false))).toBe(file);
        expect(text.split("\n")).toEqual([
            `flatline-backup verify --bundle ${file}`,
            `flatline-backup restore --bundle ${file} --target-config restore-target.json`,
            `flatline-backup compare --bundle ${file} --target-config restore-target.json`,
        ]);
        expect(text).not.toContain("--identity-file");
    });

    it("asks for the age identity on an encrypted bundle, and on a run that never said", () => {
        for (const encrypted of [true, undefined]) {
            const lines = backupRestoreCommands(run(encrypted)).split("\n");
            expect(lines).toHaveLength(3);
            for (const line of lines) {
                expect(line).toContain(".age");
                expect(line).toContain("--identity-file recovery-identity.txt");
            }
        }
    });
});
