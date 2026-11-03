import { Input } from "@qarasky/kore-ui";
import { Search } from "lucide-react";
import Form from "next/form";
import { t } from "@/lib/i18n";

/** Top-bar search; submits to /search?q=… (client navigation, works without JS). */
export function SearchBox() {
  return (
    <Form action="/search" role="search" className="w-full max-w-[720px]">
      <Input
        variant="filled"
        type="search"
        name="q"
        required
        leadingIcon={<Search />}
        aria-label={t("search.label")}
        placeholder={t("search.placeholder")}
        autoComplete="off"
      />
    </Form>
  );
}
