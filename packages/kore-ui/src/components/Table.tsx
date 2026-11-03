"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

export type TableProps = ComponentProps<"table"> & {
  /** Screen-reader caption (what the table lists). Recommended. */
  caption?: string;
  /** Classes for the bordered, scrolling wrapper. */
  containerClassName?: string;
  /** Draw the rounded hairline frame. Default true; false inside a panel that already has one. */
  framed?: boolean;
};

/** A data table: hairline frame, 48px rows, muted 13px header. Scrolls sideways when narrow. */
export function Table({ caption, className, containerClassName, framed = true, children, ...props }: TableProps) {
  return (
    <div className={cn("w-full overflow-x-auto", framed && "rounded-overlay border border-border", containerClassName)}>
      <table className={cn("w-full border-collapse text-left", className)} {...props}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("text-meta text-muted [&_tr]:border-b [&_tr]:border-border", className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-border", className)} {...props} />;
}

export type TableRowProps = ComponentProps<"tr"> & {
  /** Highlight on hover (rows that open something on click). */
  interactive?: boolean;
  selected?: boolean;
};

export function TableRow({ className, interactive, selected, ...props }: TableRowProps) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn(
        "h-row transition-colors",
        interactive && "cursor-pointer hover:bg-white/[0.03]",
        selected && "bg-accent/10 hover:bg-accent/15",
        className,
      )}
      {...props}
    />
  );
}

export type SortDirection = "asc" | "desc";

export type TableHeadProps = Omit<ComponentProps<"th">, "onClick"> & {
  /** Right-align (numbers, sizes, actions). */
  align?: "left" | "right";
  /** Makes the header a sort button. `sorted` is this column's current direction, or false. */
  onSort?: () => void;
  sorted?: SortDirection | false;
};

/** A column header (`scope="col"`). With `onSort` it is a button and sets `aria-sort`. */
export function TableHead({ className, align = "left", onSort, sorted = false, children, ...props }: TableHeadProps) {
  const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <th
      scope="col"
      aria-sort={onSort ? (sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none") : undefined}
      className={cn(
        "h-10 px-3 font-medium whitespace-nowrap first:pl-4 last:pr-4",
        align === "right" && "text-right",
        className,
      )}
      {...props}
    >
      {onSort ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            "-mx-1.5 inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 transition-colors hover:text-text",
            sorted && "text-text",
            align === "right" && "flex-row-reverse",
          )}
        >
          {children}
          <Icon aria-hidden className={cn("size-3.5", !sorted && "opacity-50")} />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export type TableCellProps = ComponentProps<"td"> & {
  align?: "left" | "right";
  /** Secondary columns (dates, roles): muted text. */
  muted?: boolean;
};

export function TableCell({ className, align = "left", muted, ...props }: TableCellProps) {
  return (
    <td
      className={cn(
        "px-3 py-2.5 first:pl-4 last:pr-4",
        align === "right" && "text-right tabular-nums",
        muted && "text-muted",
        className,
      )}
      {...props}
    />
  );
}

/** A row-header cell (`<th scope="row">`): the cell that names the row (name, email). */
export function TableRowHeader({ className, ...props }: ComponentProps<"th">) {
  return <th scope="row" className={cn("px-3 py-2.5 font-normal first:pl-4", className)} {...props} />;
}

/** A full-width row for "no results" / loading inside the table. */
export function TableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-muted">
        {children}
      </td>
    </tr>
  );
}
