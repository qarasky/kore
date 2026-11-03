import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type EmptyStateProps = {
  /** A lucide icon (rendered muted, 24px). Optional. */
  icon?: ReactNode;
  /** What is empty, as a statement: "No shared links yet". */
  title: ReactNode;
  /** What to do about it, one or two sentences. */
  description?: ReactNode;
  /** One action (usually a primary Button). */
  action?: ReactNode;
  className?: string;
};

/** Shown in place of a list or page that has nothing in it. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1 px-6 py-12 text-center", className)}>
      {icon ? (
        <div className="mb-3 grid size-12 place-items-center rounded-full bg-white/[0.04] text-muted [&_svg]:size-6">
          {icon}
        </div>
      ) : null}
      <p className="text-heading font-medium">{title}</p>
      {description ? <p className="max-w-[360px] text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
