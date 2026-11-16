"use client";

import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";
import { useLinkComponent, type LinkComponent } from "../lib/link";
import { Card } from "./Card";

export type CardListProps = ComponentProps<"ul">;

/**
 * A Card holding rows separated by hairlines: account details, the sessions of a user, a provider's models.
 * Children are `ListRow`s. For tabular data with columns and sorting use `Table`.
 */
export function CardList({ className, ...props }: CardListProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <ul className="divide-y divide-border" {...props} />
    </Card>
  );
}

export type ListRowProps = Omit<ComponentProps<"li">, "title" | "onClick"> & {
  /** A lucide icon (16px, muted) before the label. */
  icon?: ReactNode;
  /** The row's name: "Email", a device, a model. Omit it when you pass `children`. */
  label?: ReactNode;
  /** A muted second line under the label. */
  description?: ReactNode;
  /** A muted value on the right ("anna@example.com", "Today 07:43"). */
  value?: ReactNode;
  /** Controls on the far right: a Switch, an IconButton, a Menu. They stay clickable on their own. */
  actions?: ReactNode;
  /** Makes the label area a link. */
  href?: string;
  /** Makes the label area a button. Ignored when `href` is set. */
  onClick?: () => void;
  /** Let the label and description wrap instead of truncating (notes, long names). */
  wrap?: boolean;
  LinkComponent?: LinkComponent;
};

/**
 * One row of a `CardList`: 48px minimum, hairline below, the label area optionally a link or button. Pass `children`
 * instead of `label`/`description` for a row with its own content (an inline editor); `icon`, `value` and `actions`
 * still frame it.
 */
export function ListRow({
  icon,
  label,
  description,
  value,
  actions,
  href,
  onClick,
  wrap = false,
  LinkComponent,
  className,
  children,
  ...props
}: ListRowProps) {
  const Link = useLinkComponent(LinkComponent);
  const main = (
    <>
      {icon ? (
        <span aria-hidden="true" className="flex shrink-0 text-muted [&_svg:not([class*='size-'])]:size-4">
          {icon}
        </span>
      ) : null}
      {children !== undefined ? (
        <span className="min-w-0 flex-1">{children}</span>
      ) : (
        <span className="min-w-0 flex-1">
          <span className={cn("block", wrap ? "break-words" : "truncate")}>{label}</span>
          {description ? (
            <span className={cn("block text-meta text-muted", wrap ? "break-words" : "truncate")}>{description}</span>
          ) : null}
        </span>
      )}
    </>
  );
  const mainClass = "flex min-h-row min-w-0 flex-1 items-center gap-3 py-2 pl-4 text-left";
  const interactive = "outline-offset-[-2px]";
  return (
    <li
      className={cn("flex items-center pr-4 transition-colors", (href || onClick) && "hover:bg-hover-subtle", className)}
      {...props}
    >
      {href ? (
        <Link href={href} className={cn(mainClass, interactive)}>
          {main}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={cn(mainClass, interactive)}>
          {main}
        </button>
      ) : (
        <div className={mainClass}>{main}</div>
      )}
      {value ? <span className="max-w-[45%] shrink-0 truncate pl-3 text-muted">{value}</span> : null}
      {actions ? <div className="flex shrink-0 items-center gap-1 pl-3">{actions}</div> : null}
    </li>
  );
}
