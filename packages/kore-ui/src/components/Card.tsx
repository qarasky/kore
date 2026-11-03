import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

/** A hairline-bordered surface for grouping (a provider, a disk, a stat). No shadow. */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-ui border border-border bg-surface", className)} {...props} />;
}
