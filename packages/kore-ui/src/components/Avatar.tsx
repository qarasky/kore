"use client";

import { Avatar as RadixAvatar } from "radix-ui";
import { cn } from "../lib/cn";

export type AvatarProps = {
  /** Used for the initials and the `alt` text. */
  name?: string | null;
  /** Fallback source for initials when there is no name. */
  email?: string | null;
  src?: string | null;
  /** sm 24px, md 32px (default), lg 40px. */
  size?: "sm" | "md" | "lg";
  className?: string;
};

const SIZE = { sm: "size-6 text-[10px]", md: "size-8 text-meta", lg: "size-10 text-sub" } as const;

/** First letters of the first and last word of the name, else the email's first letter. */
export function initials(name?: string | null, email?: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
  if (words.length === 1) return words[0]![0]!.toUpperCase();
  return (email?.trim()[0] ?? "?").toUpperCase();
}

/** A round user picture, falling back to initials on the accent colour. Decorative: pair it with the name. */
export function Avatar({ name, email, src, size = "md", className }: AvatarProps) {
  return (
    <RadixAvatar.Root
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent font-semibold text-white select-none",
        SIZE[size],
        className,
      )}
    >
      {src ? <RadixAvatar.Image src={src} alt="" className="size-full object-cover" /> : null}
      <RadixAvatar.Fallback delayMs={src ? 300 : 0}>{initials(name, email)}</RadixAvatar.Fallback>
    </RadixAvatar.Root>
  );
}
