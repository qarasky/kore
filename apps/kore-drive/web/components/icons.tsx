import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileUp,
  FileVideo,
  Folder,
  FolderInput,
  FolderPlus,
  FolderUp,
  HardDrive,
  KeyRound,
  Link,
  ListOrdered,
  Lock,
  LogOut,
  Maximize2,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
  Undo2,
  Users,
  WrapText,
  X,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";
import type { FileKind } from "@/lib/nodes";

/** Icons come from lucide-react (bundled, tree-shaken: nothing is downloaded).
 *  Each is exported under a stable local name and sized with the `size-*`
 *  utilities (default `size-4`). */
type IconProps = LucideProps;

function icon(Glyph: LucideIcon, strokeWidth = 1.75) {
  return function KoreIcon({ className = "size-4", ...rest }: IconProps) {
    return <Glyph aria-hidden="true" strokeWidth={strokeWidth} className={`shrink-0 ${className}`} {...rest} />;
  };
}

export const PlusIcon = icon(Plus, 2);
export const ChevronRightIcon = icon(ChevronRight);
export const ChevronDownIcon = icon(ChevronDown);
export const ChevronLeftIcon = icon(ChevronLeft);
export const SearchIcon = icon(Search);
export const DriveIcon = icon(HardDrive);
export const UsersIcon = icon(Users);
export const TrashIcon = icon(Trash2);
export const ShieldIcon = icon(Shield);
export const FolderPlusIcon = icon(FolderPlus);
export const FolderMoveIcon = icon(FolderInput);
export const FileUploadIcon = icon(FileUp);
export const FolderUploadIcon = icon(FolderUp);
export const OpenIcon = icon(ExternalLink);
export const PencilIcon = icon(Pencil);
export const DownloadIcon = icon(Download);
export const CloseIcon = icon(X);
export const WrapIcon = icon(WrapText);
export const ListNumbersIcon = icon(ListOrdered);
export const ExpandIcon = icon(Maximize2);
export const RestoreIcon = icon(Undo2);
export const KeyIcon = icon(KeyRound);
export const LinkIcon = icon(Link);
export const LockIcon = icon(Lock);
export const SignOutIcon = icon(LogOut);

const KIND_COLOR: Record<FileKind, string> = {
  folder: "text-accent",
  image: "text-[#e0a85b]",
  video: "text-[#d77be0]",
  audio: "text-[#5bc8e0]",
  pdf: "text-[#f2777a]",
  archive: "text-[#c9b26b]",
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
