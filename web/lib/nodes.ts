/** Shapes and helpers shared by the file-browser pages and components. */

export type Space = "personal" | "shared";

/** A node as returned by the Go API (`nodeJSON`). */
export type ApiNode = {
  id: string;
  name: string;
  is_dir: boolean;
  size: number;
  mime: string;
  parent_id: string | null;
  space: Space;
  /** Unix seconds. */
  updated_at: number;
  /** Who uploaded it (created it, for folders): shared-space nodes in
   *  listings, search and trash only. */
  uploader_email?: string;
};

export type Usage = { used_bytes: number; quota_bytes: number };

/** URL of a folder (or the section root when `folderId` is absent). */
export function folderHref(space: Space, folderId?: string | null): string {
  const root = space === "shared" ? "/shared" : "/files";
  return folderId ? `${root}/${encodeURIComponent(folderId)}` : root;
}

export function downloadHref(id: string): string {
  return `/api/nodes/${encodeURIComponent(id)}/download`;
}

export type FileKind = "folder" | "image" | "video" | "audio" | "pdf" | "archive" | "code" | "text" | "file";

const BY_EXT: Record<string, FileKind> = {};
function reg(kind: FileKind, exts: string) {
  for (const e of exts.split(" ")) BY_EXT[e] = kind;
}
reg("image", "jpg jpeg png gif webp heic avif svg bmp tif tiff ico");
reg("video", "mp4 mkv webm mov avi m4v wmv");
reg("audio", "mp3 aac m4a ogg opus flac wav");
reg("pdf", "pdf");
reg("archive", "zip gz tgz bz2 xz 7z rar zst tar");
reg("code", "js ts tsx jsx go py rb rs java c h cpp cs php sh json yaml yml toml xml html css sql");
reg("text", "txt md log csv rtf doc docx odt xls xlsx ods ppt pptx odp");

/** Icon category for a node, from its MIME type with the extension as fallback. */
export function fileKind(node: Pick<ApiNode, "is_dir" | "name" | "mime">): FileKind {
  if (node.is_dir) return "folder";
  const dot = node.name.lastIndexOf(".");
  const ext = dot > 0 ? node.name.slice(dot + 1).toLowerCase() : "";
  if (BY_EXT[ext]) return BY_EXT[ext];
  const mime = node.mime.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/")) return "text";
  return "file";
}
