/** `GET /api/me/usage/breakdown` and its presentation (pure). */
import type { MessageKey } from "./i18n";
import type { Space } from "./nodes";
import { locationHref } from "./search";

/** Mirrors the `Cat*` constants in api/internal/quota/category.go. */
export const CATEGORY_KEYS = ["images", "video", "audio", "documents", "archives", "code", "other"] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export type Breakdown = {
  used_bytes: number;
  quota_bytes: number;
  /** Open uploads (reserved at their full size). */
  uploading_bytes: number;
  /** The part of used_bytes that is in the trash (personal + shared). */
  trash_bytes: number;
  /** ...of which in the caller's own trash (`/trash`). */
  trash_personal_bytes: number;
  /** ...of which their uploads in the shared trash (`/trash?space=shared`). */
  trash_shared_bytes: number;
  /** Sorted by bytes, largest first; only categories with files. */
  categories: { key: string; bytes: number; count: number }[];
  /** The user's ten largest live files they can open. */
  largest: { id: string; name: string; size: number; space: Space; parent_id: string | null }[];
};

const isKey = (k: string): k is CategoryKey => (CATEGORY_KEYS as readonly string[]).includes(k);

/**
 * One theme token per category, as a CSS variable so the bars follow the
 * theme (the accent for "images", the violet of "maintenance" for video, the
 * chart series, the warning amber, the neutral muted grey for "other").
 * Used in inline styles, where Tailwind classes can't be built from the key.
 */
const COLORS: Record<CategoryKey, string> = {
  images: "var(--color-accent)",
  video: "var(--color-status-maint)",
  audio: "var(--color-chart-4)",
  documents: "var(--color-chart-2)",
  archives: "var(--color-warning)",
  code: "var(--color-status-up)",
  other: "var(--color-muted)",
};

export function categoryColor(key: string): string {
  return COLORS[isKey(key) ? key : "other"];
}

export function categoryLabelKey(key: string): MessageKey {
  return `storage.cat.${isKey(key) ? key : "other"}`;
}

/** `part` as a percent of `used` (0..100; 0 when nothing is used). */
export function sharePercent(part: number, used: number): number {
  if (!(used > 0)) return 0;
  return Math.min(100, Math.max(0, (part / used) * 100));
}

/** The folder holding a largest file, with that file selected. */
export function largestHref(f: Breakdown["largest"][number]): string {
  return locationHref(f);
}
