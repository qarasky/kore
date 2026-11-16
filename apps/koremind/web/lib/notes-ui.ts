import type { Activity } from "@koremind/shared";
import { t } from "./strings";

export type PendingApproval = { id: string; action: "read" | "edit"; chat: string };

/** Chip text for what the assistant did with notes or memory. */
export function activityText(a: Activity): string {
  switch (a.kind) {
    case "saved": return t.activitySaved(a.title);
    case "edited": return t.activityEdited(a.title);
    case "read": return a.chat ? t.activityReadOther(a.chat) : t.activityRead;
    case "denied": return t.activityDenied(a.chat ?? a.title);
    case "memory_saved": return t.activityMemorySaved(a.title);
    case "memory_updated": return t.activityMemoryUpdated(a.title);
    case "memory_read": return a.title ? t.activityMemoryReadFor(a.title) : t.activityMemoryRead;
    case "memory_deleted": return t.activityMemoryDeleted(a.title);
  }
}

/** The approval card's question. */
export const approvalText = (p: PendingApproval) => (p.action === "edit" ? t.approvalEdit(p.chat) : t.approvalRead(p.chat));
