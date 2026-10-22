import type { ReactNode } from "react";

/** A centered title + explanation for empty, prompt and error states. */
export function PageMessage({ title, children, testId }: { title: string; children?: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className="flex flex-1 flex-col items-center justify-center gap-1 px-6 py-12 text-center">
      <p className="max-w-[520px] text-heading font-medium break-words">{title}</p>
      {children && <p className="max-w-[420px] text-muted">{children}</p>}
    </div>
  );
}
