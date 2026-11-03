import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2 py-px text-2xs leading-[18px] font-medium whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-white/[0.06] text-muted",
        accent: "bg-accent/15 text-accent",
        success: "bg-status-up/15 text-status-up",
        warning: "bg-warning/15 text-warning",
        danger: "bg-danger/15 text-danger",
        maint: "bg-status-maint/15 text-status-maint",
        outline: "border border-border-strong px-[7px] text-muted",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

/** A short label pill ("You", "Admin", "Disabled", "Free"). One or two words, sentence case. */
export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
