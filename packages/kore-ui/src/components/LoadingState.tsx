import { cn } from "../lib/cn";
import { Spinner } from "./Spinner";

export type LoadingStateProps = {
  /** What is loading, in words. Default "Loading…". */
  label?: string;
  className?: string;
};

/** A spinner and its words, centred in the space the content will take: the first load of a page that has no shape to skeleton. */
export function LoadingState({ label = "Loading…", className }: LoadingStateProps) {
  return (
    <div role="status" className={cn("flex flex-1 items-center justify-center gap-2.5 px-6 py-12 text-muted", className)}>
      <Spinner size={18} />
      <span>{label}</span>
    </div>
  );
}
