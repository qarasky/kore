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
  /** The part of used_bytes that is in the trash. */
  trash_bytes: number;
  /** Sorted by bytes, largest first; only categories with files. */
  categories: { key: string; bytes: number; count: number }[];
  /** The user's ten largest live files they can open. */
  largest: { id: string; name: string; size: number; space: Space; parent_id: string | null }[];
};

const isKey = (k: string): k is CategoryKey => (CATEGORY_KEYS as readonly string[]).includes(k);

/**
 * One hue per category, spaced around the accent (#5b8def, "images") at a
 * similar lightness, so each bar keeps at least 3:1 contrast against the
 * raised surface (#23262d); "other" is the neutral muted grey.
 */
const COLORS: Record<CategoryKey, string> = {
  images: "#5b8def",
  video: "#a77ff0",
  audio: "#e27bb7",
  documents: "#4fbfa6",
  archives: "#e5a54b",
  code: "#8ec46a",
  other: "#8a8f9a",
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
