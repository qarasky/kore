import { describe, expect, it } from "vitest";
import { exportFileName, summarizeImport } from "@/lib/ics";
import { generatePassword } from "@/lib/password";
import type { ImportResult } from "@/lib/types";

const result = (p: Partial<ImportResult>): ImportResult => ({ imported: 0, created: 0, updated: 0, errors: [], warnings: [], ...p });

describe("summarizeImport", () => {
  it("words the headline for none, one and many", () => {
    expect(summarizeImport(result({})).headline).toBe("Nothing was imported.");
    expect(summarizeImport(result({ imported: 1, created: 1 })).headline).toBe("Imported 1 event (1 new, 0 updated).");
    expect(summarizeImport(result({ imported: 3, created: 2, updated: 1 })).headline).toBe("Imported 3 events (2 new, 1 updated).");
  });

  it("lists errors first, then warnings, labelling events by position and UID", () => {
    const s = summarizeImport(
      result({
        imported: 1,
        created: 1,
        errors: [
          { index: 2, uid: "nostart@example.com", reason: "the event has no DTSTART" },
          { index: 0, uid: "", reason: "only daily, weekly, monthly and yearly repeats are supported" },
        ],
        warnings: [{ index: -1, uid: "abc@google.com", reason: "changed occurrence without its series ignored" }, { index: 4, uid: "w@x", reason: "unknown time zone" }],
      }),
    );
    expect(s.issues).toEqual([
      { kind: "error", label: "Event 3 (nostart@example.com)", reason: "the event has no DTSTART" },
      { kind: "error", label: "Event 1", reason: "only daily, weekly, monthly and yearly repeats are supported" },
      { kind: "warning", label: "Changed occurrence (abc@google.com)", reason: "changed occurrence without its series ignored" },
      { kind: "warning", label: "Event 5 (w@x)", reason: "unknown time zone" },
    ]);
  });
});

describe("exportFileName", () => {
  it("names the file after the calendar and the date", () => {
    expect(exportFileName("Work", "2026-11-02")).toBe("work-2026-11-02.ics");
    expect(exportFileName("My Health & Fitness!", "2026-11-02")).toBe("my-health-fitness-2026-11-02.ics");
    expect(exportFileName(null, "2026-11-02")).toBe("calendar-2026-11-02.ics");
    expect(exportFileName("???", "2026-11-02")).toBe("calendar-2026-11-02.ics");
  });
});

describe("generatePassword", () => {
  it("makes a long, readable, different password each time", () => {
    const a = generatePassword();
    const b = generatePassword();
    expect(a).toHaveLength(18);
    expect(a).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/); // no look-alike characters (0 O 1 l I)
    expect(a).not.toBe(b);
  });
});
