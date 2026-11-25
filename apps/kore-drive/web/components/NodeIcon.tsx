import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  type LucideIcon,
} from "lucide-react";
import type { FileKind } from "@/lib/nodes";

/* File-kind tints: app-specific (kore-ui has no file icons), drawn from the theme's tokens so they stay
   readable in Light and Dark. Folder uses the accent, as text (`accent-fg`). */
const KIND_COLOR: Record<FileKind, string> = {
  folder: "text-accent-fg",
  image: "text-warning",
  video: "text-status-maint",
  audio: "text-chart-4",
  pdf: "text-danger",
  archive: "text-chart-1",
  code: "text-status-up",
  text: "text-chart-2",
  file: "text-muted",
};

const KIND_GLYPH: Record<Exclude<FileKind, "folder">, LucideIcon> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  pdf: FileText,
  archive: FileArchive,
  code: FileCode,
  text: FileText,
  file: File,
};

/** Folder or file icon, tinted by kind. */
export function NodeIcon({ kind, className = "size-icon" }: { kind: FileKind; className?: string }) {
  if (kind === "folder") {
    return (
      <Folder
        aria-hidden="true"
        strokeWidth={1.5}
        fill="currentColor"
        fillOpacity={0.85}
        className={`shrink-0 ${KIND_COLOR.folder} ${className}`}
      />
    );
  }
  const Glyph = KIND_GLYPH[kind];
  return <Glyph aria-hidden="true" strokeWidth={1.5} className={`shrink-0 ${KIND_COLOR[kind]} ${className}`} />;
}
