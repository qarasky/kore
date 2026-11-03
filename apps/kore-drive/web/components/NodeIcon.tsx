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

/* File-kind tints: app-specific (kore-ui has no file icons). Folder uses the accent. */
const KIND_COLOR: Record<FileKind, string> = {
  folder: "text-accent",
  image: "text-[#e0a85b]",
  video: "text-[#d77be0]",
  audio: "text-[#5bc8e0]",
  pdf: "text-danger",
  archive: "text-warning",
  code: "text-[#7fd18b]",
  text: "text-[#a9b4c8]",
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
