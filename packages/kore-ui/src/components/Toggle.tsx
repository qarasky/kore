"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Toggle as RadixToggle, ToggleGroup as RadixToggleGroup } from "radix-ui";
import { createContext, useContext, type ComponentProps } from "react";
import { cn } from "../lib/cn";

export const toggleVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 border font-medium whitespace-nowrap transition-colors select-none " +
    "border-border-strong text-text hover:bg-hover " +
    "data-[state=on]:border-accent/60 data-[state=on]:bg-accent/15 data-[state=on]:hover:bg-accent/20 " +
    "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent " +
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      size: {
        md: "min-h-control px-4 text-[15px]",
        sm: "min-h-control-sm px-3 text-sub",
      },
      shape: {
        /** A rounded rectangle, like a Button. */
        default: "rounded-ui",
        /** A pill, or a circle when width equals height (weekday letters). */
        round: "rounded-full",
      },
    },
    defaultVariants: { size: "sm", shape: "default" },
  },
);

export type ToggleButtonProps = ComponentProps<typeof RadixToggle.Root> & VariantProps<typeof toggleVariants>;

/**
 * A button that is on or off and stays that way: a filter chip, "Bold", "Only mine". Sets `aria-pressed`; the
 * pressed look is an accent hairline and a soft accent fill, so the state never rests on colour alone: keep the
 * label the same and let `aria-pressed` carry the state, or pair an icon that changes. Controlled
 * (`pressed` + `onPressedChange`) or uncontrolled (`defaultPressed`). A setting that applies at once is a
 * `Switch`; a choice submitted later is a `Checkbox`. 32px by default (`size="md"` for 40px).
 */
export function ToggleButton({ className, size, shape, ...props }: ToggleButtonProps) {
  return <RadixToggle.Root className={cn(toggleVariants({ size, shape }), className)} {...props} />;
}

type GroupStyle = Pick<VariantProps<typeof toggleVariants>, "size" | "shape">;
const GroupStyleContext = createContext<GroupStyle>({});

export type ToggleGroupProps = (
  | Omit<ComponentProps<typeof RadixToggleGroup.Root> & { type: "single" }, "dir">
  | Omit<ComponentProps<typeof RadixToggleGroup.Root> & { type: "multiple" }, "dir">
) &
  GroupStyle & {
    /** Fuse the items into one segmented control (a time range: 1h · 24h · 7d). Default: separate chips. */
    joined?: boolean;
  };

/**
 * Several ToggleButtons that belong together. `type="single"` picks one (a radio group: arrows move, and the
 * value can be cleared by pressing the chosen item again unless you ignore the empty `""` value);
 * `type="multiple"` picks any (weekdays). Name it with `aria-label`. Arrow keys move between items.
 */
export function ToggleGroup({ className, size, shape, joined = false, ...props }: ToggleGroupProps) {
  return (
    <GroupStyleContext value={{ size, shape }}>
      <RadixToggleGroup.Root
        className={cn(
          "inline-flex flex-wrap items-center",
          joined
            ? "[&>*]:rounded-none [&>*:first-child]:rounded-l-ui [&>*:last-child]:rounded-r-ui [&>*+*]:-ml-px [&>[data-state=on]]:z-[1]"
            : "gap-1.5",
          className,
        )}
        {...props}
      />
    </GroupStyleContext>
  );
}

export type ToggleGroupItemProps = ComponentProps<typeof RadixToggleGroup.Item> & GroupStyle;

/** One option of a ToggleGroup. `value` identifies it; it needs visible text or an `aria-label`. */
export function ToggleGroupItem({ className, size, shape, ...props }: ToggleGroupItemProps) {
  const group = useContext(GroupStyleContext);
  return (
    <RadixToggleGroup.Item
      className={cn(toggleVariants({ size: size ?? group.size, shape: shape ?? group.shape }), className)}
      {...props}
    />
  );
}
