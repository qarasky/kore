import { EmptyState, PageHeader } from "@qarasky/kore-ui";
import { CircleAlert, Search, SearchX } from "lucide-react";
import type { Metadata } from "next";
import { SearchResults } from "@/components/SearchResults";
import { api, isApiError } from "@/lib/api";
import { t, type MessageKey } from "@/lib/i18n";
import { SEARCH_LIMIT, searchErrorKey, type SearchHit } from "@/lib/search";
import { requireUser } from "@/lib/session";

function queryFrom(q: string | string[] | undefined): string {
  return (typeof q === "string" ? q : (q?.[0] ?? "")).trim();
}

export async function generateMetadata({ searchParams }: PageProps<"/search">): Promise<Metadata> {
  const query = queryFrom((await searchParams).q);
  return { title: query ? t("search.resultsFor", { query }) : t("search.title") };
}

/** `/search?q=`: results from `GET /api/search` (personal + shared space). */
export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  await requireUser();
  const query = queryFrom((await searchParams).q);

  let hits: SearchHit[] | null = null;
  let error: MessageKey | null = null;
  if (query) {
    try {
      hits = await api<SearchHit[]>(`/api/search?${new URLSearchParams({ q: query, limit: String(SEARCH_LIMIT) })}`);
    } catch (e) {
      if (!isApiError(e, 400)) throw e;
      error = searchErrorKey(e.code);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={<span data-testid="search-heading">{hits ? t("search.resultsFor", { query }) : t("search.title")}</span>}
        actions={
          hits && hits.length >= SEARCH_LIMIT ? (
            <p className="truncate text-meta text-muted">{t("search.limited", { count: hits.length })}</p>
          ) : undefined
        }
      />
      {error ? (
        <div data-testid="search-error" className="flex flex-1 flex-col justify-center">
          <EmptyState icon={<CircleAlert />} title={t(error)} />
        </div>
      ) : !hits ? (
        <div data-testid="search-prompt" className="flex flex-1 flex-col justify-center">
          <EmptyState icon={<Search />} title={t("search.promptTitle")} description={t("search.prompt")} />
        </div>
      ) : hits.length === 0 ? (
        <div data-testid="search-empty" className="flex flex-1 flex-col justify-center">
          <EmptyState icon={<SearchX />} className="[overflow-wrap:anywhere]" title={t("search.noResultsTitle", { query })} description={t("search.noResults")} />
        </div>
      ) : (
        <SearchResults key={query} hits={hits} />
      )}
    </div>
  );
}
