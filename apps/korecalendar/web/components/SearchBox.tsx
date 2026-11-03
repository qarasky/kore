"use client";

import { Input } from "@qarasky/kore-ui";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { t } from "@/lib/i18n";

/** The search field (kore-ui's filled top-bar input); submitting opens `/search?q=`. */
export function SearchBox({ initial = "", className = "w-56" }: { initial?: string; className?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);

  function submit(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (query) router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  return (
    <form role="search" onSubmit={submit} className={className}>
      <Input
        type="search"
        name="q"
        size="sm"
        variant="filled"
        data-search-input
        aria-label={t("nav.search")}
        placeholder={t("nav.searchPlaceholder")}
        leadingIcon={<Search />}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
    </form>
  );
}
