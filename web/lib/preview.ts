/**
 * Which files the preview pane opens, and with which viewer. The text list
 * mirrors `textExts` / `textNames` in `api/internal/httpapi/preview.go`, the
 * image/PDF list `viewExts` in `api/internal/transfer/view.go`, so other
 * files download without a wasted request. The API stays the source of
 * truth: a name listed here can still answer 415 (a NUL byte in a .txt, a
 * .png that is not a PNG), and the pane then falls back to downloading.
 * SVG is never previewed (it can carry script); it downloads.
 */

/** Same as the server's limit (`previewMax`), shown in the truncated notice. */
export const PREVIEW_MAX_BYTES = 512 << 10;

const TEXT_EXTS = new Set(
  (
    "txt md markdown json yaml yml toml xml csv tsv log ini cfg conf env sh bash zsh fish go rs js jsx ts tsx " +
    "mjs cjs py rb java kt c h cpp hpp cs php swift sql css scss html htm vue svelte lua pl r tex rst properties " +
    "gradle dockerfile makefile"
  ).split(" "),
);
const TEXT_NAMES = new Set(["Dockerfile", "Makefile", "README", "LICENSE", ".gitignore", ".env"]);

/** Shown with `<img>` / the browser's PDF viewer via `GET /api/nodes/{id}/view`. */
const VIEW_EXTS: Record<string, "image" | "pdf"> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  bmp: "image",
  pdf: "pdf",
};

export type PreviewKind = "text" | "image" | "pdf";

/** Lowercased extension like Go's `path.Ext` (".gitignore" → "gitignore"). */
function ext(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** The viewer for a file name, or null when it downloads instead. */
export function previewKind(name: string): PreviewKind | null {
  if (TEXT_NAMES.has(name) || TEXT_EXTS.has(ext(name))) return "text";
  return Object.hasOwn(VIEW_EXTS, ext(name)) ? VIEW_EXTS[ext(name)] : null;
}

export function isPreviewable(name: string): boolean {
  return previewKind(name) !== null;
}

/** The inline (image/PDF) endpoint for a node. */
export function viewHref(id: string): string {
  return `/api/nodes/${encodeURIComponent(id)}/view`;
}

export function isMarkdown(name: string): boolean {
  const e = ext(name);
  return e === "md" || e === "markdown";
}

/** Prose-like files start without line numbers; code and config with them. */
export function defaultLineNumbers(name: string): boolean {
  return !["txt", "log", "csv", "tsv", "rst", "tex"].includes(ext(name)) && !TEXT_NAMES.has(name);
}

/** Splits text into lines (`\n`, `\r\n` or `\r`); a final newline adds no empty line. */
export function splitLines(text: string): string[] {
  if (text === "") return [""];
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

/** Previewable entries of `nodes` (files only: text, images, PDF), in order, for prev/next. */
export function previewable<T extends { is_dir: boolean; name: string }>(nodes: readonly T[]): T[] {
  return nodes.filter((n) => !n.is_dir && isPreviewable(n.name));
}

/**
 * The `href` a markdown link may keep, or null to render it as plain text.
 * Only absolute http(s)/mailto URLs and in-document `#fragments` survive, so
 * `javascript:`, `data:`, `vbscript:` (however obfuscated with case, spaces
 * or control characters: the WHATWG parser normalizes those exactly like a
 * browser would) and relative or protocol-relative URLs are dropped.
 */
export function safeLinkHref(raw: string | null | undefined): { href: string; external: boolean } | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (url === "") return null;
  if (url.startsWith("#")) return { href: url, external: false };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null; // relative or garbage
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    return { href: parsed.href, external: true };
  }
  if (parsed.protocol === "mailto:") return { href: parsed.href, external: true };
  return null;
}
