import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export type SkeletonProps = ComponentProps<"div"> & {
  /** Pulse while loading. Default true. Turn it off for screens that stay open all day and load quietly. */
  pulse?: boolean;
};

/** A loading placeholder in the shape of the content. Size it with classes (`h-4 w-32`). */
export function Skeleton({ className, pulse = true, ...props }: SkeletonProps) {
  return <div aria-hidden="true" className={cn("rounded-ui bg-track", pulse && "animate-pulse", className)} {...props} />;
}
