import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover disabled:hover:bg-accent",
  secondary: "border border-border bg-raised text-text hover:border-border-strong",
  ghost: "text-text hover:bg-raised",
  danger: "border border-danger/50 text-danger hover:bg-danger/10",
};

export function buttonClass(variant: Variant = "secondary", small = false): string {
  return (
    `inline-flex items-center justify-center gap-2 rounded-ui font-medium whitespace-nowrap transition-colors disabled:opacity-60 ` +
    `${small ? "min-h-control-sm px-3 text-sub" : "min-h-control px-4"} ${variants[variant]}`
  );
}

export function Button({
  variant = "secondary",
  small = false,
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; small?: boolean }) {
  return <button type={type} className={`${buttonClass(variant, small)} ${className}`} {...rest} />;
}

/** A square icon-only button (needs an aria-label). */
export function iconButtonClass(): string {
  return "inline-grid size-control-sm place-items-center rounded-ui text-muted transition-colors hover:bg-raised hover:text-text";
}
