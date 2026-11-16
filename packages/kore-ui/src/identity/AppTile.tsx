import { cn } from "../lib/cn";
import { AppMark } from "./AppMark";
import { KORE_PRODUCTS, type ProductId } from "./apps";

export type AppTileProps = {
  /** A Kore product, or any other key (a client app registered in Kore ID): unknown keys show initials. */
  app: ProductId | (string & {});
  /** The name the initials come from when `app` isn't a Kore product. Defaults to the key. */
  name?: string;
  /** md 40px (default) or sm 32px. */
  size?: "md" | "sm";
  className?: string;
};

function initialsOf(text: string): string {
  const words = text.split(/[\s_.-]+/).filter(Boolean);
  const letters = words.length > 1 ? (words[0]?.[0] ?? "") + (words[1]?.[0] ?? "") : text.slice(0, 2);
  return letters.toUpperCase();
}

/** An app's mark in a bordered square: the tile of an app list. Apps Kore doesn't know get their initials. */
export function AppTile({ app, name, size = "md", className }: AppTileProps) {
  const known = app in KORE_PRODUCTS;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-ui border border-border bg-bg/60",
        size === "sm" ? "size-control-sm" : "size-control",
        className,
      )}
    >
      {known ? (
        <AppMark app={app as ProductId} size={size === "sm" ? 16 : 20} />
      ) : (
        <span className="text-meta font-semibold text-muted">{initialsOf(name ?? app)}</span>
      )}
    </span>
  );
}
