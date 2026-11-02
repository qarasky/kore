"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { t } from "@/lib/i18n";
import { SearchIcon } from "./icons";

/** The top bar's search field; submitting opens `/search?q=`. */
export function SearchBox({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);

  function submit(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (query) router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  return (
    <form role="search" onSubmit={submit} className="relative hidden md:block">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" size={16} />
      <input
        type="search"
        name="q"
        data-search-input
        aria-label={t("nav.search")}
        placeholder={t("nav.searchPlaceholder")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="min-h-control-sm w-44 rounded-ui border border-border bg-surface pr-3 pl-8 text-sub text-text outline-none transition-[width,border-color] placeholder:text-muted hover:border-border-strong focus:w-64 focus:border-accent"
      />
    </form>
  );
}
