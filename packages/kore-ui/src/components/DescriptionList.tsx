import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

export type DescriptionItem = {
  /** The term, 13px muted: "Issuer", "Redirect URI". */
  label: ReactNode;
  /** The value, or several (one line each). */
  value: ReactNode | ReactNode[];
  /** Monospace value (URLs, ids). */
  mono?: boolean;
  /** Stable key when labels aren't strings. */
  id?: string;
};

export type DescriptionListProps = Omit<ComponentProps<"dl">, "children"> & {
  items: DescriptionItem[];
  /** Stack label over value on every width. Default: side by side from `sm`. */
  stacked?: boolean;
};

/**
 * Label and value pairs ("Issuer · https://id.example.com"): a real `dl`, hairlines between rows, values that
 * wrap. Use it for read-only facts (client endpoints, account details); editable rows are `ListRow`s with controls.
 */
export function DescriptionList({ items, stacked = false, className, ...props }: DescriptionListProps) {
  return (
    <dl className={cn("divide-y divide-border", className)} {...props}>
      {items.map((item, index) => {
        const values = Array.isArray(item.value) ? item.value : [item.value];
        return (
          <div
            key={item.id ?? (typeof item.label === "string" ? item.label : index)}
            className={cn("flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0", !stacked && "sm:flex-row sm:gap-4")}
          >
            <dt className={cn("shrink-0 text-meta text-muted", !stacked && "sm:w-40 sm:pt-px")}>{item.label}</dt>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {values.map((value, i) => (
                <dd key={i} className={cn("min-w-0 break-words", item.mono && "font-mono text-sub")}>
                  {value}
                </dd>
              ))}
            </div>
          </div>
        );
      })}
    </dl>
  );
}
