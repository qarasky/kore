/**
 * Which files the preview pane opens. The list mirrors `textExts` /
 * `textNames` in `api/internal/httpapi/preview.go` so obviously binary files
 * download without a wasted request. The API stays the source of truth: a
 * name listed here can still answer 415 (e.g. a NUL byte), and the pane then
 * falls back to downloading.
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

/** Lowercased extension like Go's `path.Ext` (".gitignore" → "gitignore"). */
function ext(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isPreviewable(name: string): boolean {
  return TEXT_NAMES.has(name) || TEXT_EXTS.has(ext(name));
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

/** Previewable entries of `nodes` (files only), in order, for prev/next. */
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
