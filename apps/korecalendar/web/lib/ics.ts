/** Wording for .ics import results and export file names. Pure. */
import { t } from "./i18n";
import type { ImportIssue, ImportResult } from "./types";

export type Issue = { kind: "error" | "warning"; label: string; reason: string };

function label(i: ImportIssue): string {
  if (i.index < 0) return t("import.orphanLabel", { uid: i.uid });
  return i.uid ? t("import.eventLabelUid", { n: i.index + 1, uid: i.uid }) : t("import.eventLabel", { n: i.index + 1 });
}

/** The sentence and the list of problems to show after an import. */
export function summarizeImport(r: ImportResult): { headline: string; issues: Issue[] } {
  const headline =
    r.imported === 0
      ? t("import.none")
      : t(r.imported === 1 ? "import.one" : "import.many", { count: r.imported, created: r.created, updated: r.updated });
  return {
    headline,
    issues: [
      ...r.errors.map((i): Issue => ({ kind: "error", label: label(i), reason: i.reason })),
      ...r.warnings.map((i): Issue => ({ kind: "warning", label: label(i), reason: i.reason })),
    ],
  };
}

/** "work-2026-11-02.ics" for a calendar, "calendar-2026-11-02.ics" otherwise. */
export function exportFileName(calendarName: string | null, date: string): string {
  const slug = (calendarName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug || "calendar"}-${date}.ics`;
}
