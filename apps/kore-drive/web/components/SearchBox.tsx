import Form from "next/form";
import { t } from "@/lib/i18n";
import { SearchIcon } from "./icons";

/** Top-bar search; submits to /search?q=… (client navigation, works without JS). */
export function SearchBox() {
  return (
    <Form action="/search" role="search" className="relative w-full max-w-[560px]">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
      <input
        type="search"
        name="q"
        required
        aria-label={t("search.label")}
        placeholder={t("search.placeholder")}
        autoComplete="off"
        className={
          "block w-full rounded-ui border border-transparent bg-raised py-1.5 pr-3 pl-9 text-text " +
          "placeholder:text-muted outline-none transition-colors hover:border-border-strong " +
          "focus:border-accent focus:ring-2 focus:ring-accent/25"
        }
      />
    </Form>
  );
}
