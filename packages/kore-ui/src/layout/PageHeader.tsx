"use client";

import { ChevronRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useLinkComponent, type LinkComponent } from "../lib/link";

export type Crumb = { label: ReactNode; href?: string };

export type PageHeaderProps = {
  /** The page's name (the `<h1>`). Sentence case. */
  title: ReactNode;
  /** Parent pages, shown before the title as links. */
  breadcrumbs?: Crumb[];
  /** Muted text after the title (a count: "4 users"). */
  meta?: ReactNode;
  /** Section tabs next to the title (NavTabs or TabsList). */
  tabs?: ReactNode;
  /** Right side: page actions, the primary one last. */
  actions?: ReactNode;
  breadcrumbLabel?: string;
  LinkComponent?: LinkComponent;
  className?: string;
};

/** The 52px bar at the top of the main panel: title (or breadcrumbs + title), tabs, actions. */
export function PageHeader({
  title,
  breadcrumbs,
  meta,
  tabs,
  actions,
  breadcrumbLabel = "Breadcrumb",
  LinkComponent,
  className,
}: PageHeaderProps) {
  const Link = useLinkComponent(LinkComponent);
  const heading = <h1 className="truncate text-heading font-semibold">{title}</h1>;
  return (
    <header
      className={cn("flex min-h-header shrink-0 items-center gap-4 border-b border-border px-4 py-1.5 md:px-5", className)}
    >
      <div className="flex min-w-0 items-center gap-2">
        {breadcrumbs?.length ? (
          <nav aria-label={breadcrumbLabel} className="flex min-w-0 items-center">
            <ol className="flex min-w-0 items-center gap-1.5">
              {breadcrumbs.map((c, i) => (
                <Fragment key={i}>
                  <li className="shrink-0 text-heading text-muted max-sm:hidden">
                    {c.href ? (
                      <Link href={c.href} className="rounded-[4px] hover:text-text">
                        {c.label}
                      </Link>
                    ) : (
                      c.label
                    )}
                  </li>
                  <li aria-hidden="true" className="text-muted max-sm:hidden">
                    <ChevronRight className="size-4 opacity-60" />
                  </li>
                </Fragment>
              ))}
              <li aria-current="page" className="min-w-0">
                {heading}
              </li>
            </ol>
          </nav>
        ) : (
          heading
        )}
        {meta ? <span className="shrink-0 text-meta text-muted">{meta}</span> : null}
      </div>
      {tabs ? <div className="min-w-0">{tabs}</div> : null}
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export type PageBodyProps = {
  /** form 576px (settings, account), content 1040px (tables, admin, default), reading 768px, full. */
  width?: "form" | "reading" | "content" | "full";
  className?: string;
  children: ReactNode;
};

const WIDTH = { form: "max-w-form", reading: "max-w-reading", content: "max-w-content", full: "" };

/** The scrolling area under a PageHeader, with a centred content column and 24px padding. */
export function PageBody({ width = "content", className, children }: PageBodyProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cn("mx-auto w-full p-4 md:p-6", WIDTH[width], className)}>{children}</div>
    </div>
  );
}

export type SectionHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** h2 (default) or h3. */
  as?: "h2" | "h3";
  className?: string;
};

/** A heading inside a page: title, a muted line, actions on the right ("Users · 4 users · Add user"). */
export function SectionHeader({ title, description, actions, as: H = "h2", className }: SectionHeaderProps) {
  return (
    <div className={cn("mb-4 flex items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <H className="text-title font-semibold tracking-[-0.01em]">{title}</H>
        {description ? <p className="mt-0.5 text-meta text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
