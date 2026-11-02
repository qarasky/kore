import type { ReactNode } from "react";

/** A titled block on a settings page. */
export function SettingsSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="border-b border-border px-6 py-5 last:border-b-0">
      <h2 className="text-heading font-semibold tracking-[-0.01em]">{title}</h2>
      {description ? <p className="mt-1 max-w-2xl text-sub text-muted">{description}</p> : null}
      <div className="mt-4 max-w-2xl">{children}</div>
    </section>
  );
}
