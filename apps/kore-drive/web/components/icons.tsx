import type { SVGProps } from "react";
import type { FileKind } from "@/lib/nodes";

/** Small inline 16px stroke icons (no icon font, nothing downloaded). */
type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, className = "size-4", ...rest }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      {...rest}
    >
      {children}
    </svg>
  );
}

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3v10M3 8h10" strokeWidth={1.8} />
  </Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 3.5 4.5 4.5L6 12.5" />
  </Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3.5 6 4.5 4.5L12.5 6" />
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3" />
  </Svg>
);

export const DriveIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M2 9.5h12M11 11.25h.01" />
  </Svg>
);

export const UsersIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="5.5" r="2.25" />
    <path d="M2 13c.4-2.2 2-3.5 4-3.5s3.6 1.3 4 3.5" />
    <path d="M10.5 3.6a2.25 2.25 0 0 1 0 3.9M12 9.8c1 .5 1.7 1.6 2 3.2" />
  </Svg>
);

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.6 8.5h6.8l.6-8.5" />
  </Svg>
);

export const ShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2 3 4v4c0 3 2.2 5 5 6 2.8-1 5-3 5-6V4L8 2Z" />
  </Svg>
);

export const FolderPlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 4.5c0-.8.7-1.5 1.5-1.5h3l1.5 1.5h4.5c.8 0 1.5.7 1.5 1.5v5.5c0 .8-.7 1.5-1.5 1.5h-9c-.8 0-1.5-.7-1.5-1.5v-7Z" />
    <path d="M8 7v4M6 9h4" />
  </Svg>
);

export const FileUploadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 2H4.5C3.7 2 3 2.7 3 3.5v9c0 .8.7 1.5 1.5 1.5h7c.8 0 1.5-.7 1.5-1.5V6L9 2Z" />
    <path d="M8 12V8M6.2 9.8 8 8l1.8 1.8" />
  </Svg>
);

export const FolderUploadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 4.5c0-.8.7-1.5 1.5-1.5h3l1.5 1.5h4.5c.8 0 1.5.7 1.5 1.5v5.5c0 .8-.7 1.5-1.5 1.5h-9c-.8 0-1.5-.7-1.5-1.5v-7Z" />
    <path d="M8 11V7.5M6.3 9.2 8 7.5l1.7 1.7" />
  </Svg>
);

export const OpenIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5" />
  </Svg>
);

export const PencilIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m10.5 3 2.5 2.5L6 12.5H3.5V10L10.5 3Z" />
  </Svg>
);

export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3.5 5.5 8l4.5 4.5" />
  </Svg>
);

export const WrapIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 4h11M2.5 8h9a2 2 0 0 1 0 4H8M9.5 10.5 8 12l1.5 1.5M2.5 12h3" />
  </Svg>
);

export const ListNumbersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 4h7M6.5 8h7M6.5 12h7M2.5 3l1-.5V5.5M2.3 9.8c.2-.5.6-.8 1.1-.8.6 0 1 .4 1 .9 0 .8-2.1 1.6-2.1 2.6h2.2" />
  </Svg>
);

export const RestoreIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8a5 5 0 1 0 1.5-3.5M3 2.5v2.5h2.5" />
  </Svg>
);

export const KeyIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5.5" cy="10.5" r="3" />
    <path d="m7.7 8.3 5.3-5.3M11 5l1.5 1.5" />
  </Svg>
);

export const SignOutIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 13.5h-3v-11h3M10 5l3 3-3 3M13 8H6.5" />
  </Svg>
);

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

const KIND_MARK: Partial<Record<FileKind, string>> = {
  image: "M5.5 12 7.5 9.5l1.25 1.5L10 9.5l1.5 2.5",
  video: "m7 8.5 3 1.75L7 12V8.5Z",
  audio: "M7.5 12V8.5l3-.75V11M7.5 12a1 1 0 1 1-1-1 1 1 0 0 1 1 1ZM10.5 11a1 1 0 1 1-1-1",
  pdf: "M5.5 10h5M5.5 12h3",
  archive: "M8 6v1M8 8v1M8 10v1",
  code: "m6.5 9-1.25 1.5L6.5 12M9.5 9l1.25 1.5L9.5 12",
  text: "M5.5 8.5h5M5.5 10.5h5M5.5 12.5h3",
};

/** Folder or file icon, tinted and marked by kind. */
export function NodeIcon({ kind, className = "size-4" }: { kind: FileKind; className?: string }) {
  if (kind === "folder") {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" className={`shrink-0 ${KIND_COLOR.folder} ${className}`}>
        <path
          d="M1.5 4c0-.8.7-1.5 1.5-1.5h3.2c.4 0 .8.2 1.1.5l1 1h4.7c.8 0 1.5.7 1.5 1.5v6.5c0 .8-.7 1.5-1.5 1.5H3c-.8 0-1.5-.7-1.5-1.5V4Z"
          fill="currentColor"
          fillOpacity={0.85}
        />
      </svg>
    );
  }
  const mark = KIND_MARK[kind];
  return (
    <Svg className={`${KIND_COLOR[kind]} ${className}`}>
      <path d="M4 1.75h5L12.5 5.25v8.25c0 .4-.3.75-.75.75h-7.5c-.4 0-.75-.35-.75-.75V2.5c0-.4.35-.75.75-.75Z" />
      <path d="M9 1.75v3.5h3.5" />
      {mark && <path d={mark} strokeWidth={1.2} />}
    </Svg>
  );
}
