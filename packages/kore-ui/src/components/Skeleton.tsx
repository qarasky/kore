import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

/** A loading placeholder in the shape of the content. Size it with classes (`h-4 w-32`). */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-ui bg-white/[0.06]", className)} {...props} />;
}
