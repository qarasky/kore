import type { Metadata } from "next";
import { PageMessage } from "@/components/PageMessage";
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
      <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border px-4">
        <h1 className="min-w-0 truncate text-[14px] font-semibold" data-testid="search-heading">
          {hits ? t("search.resultsFor", { query }) : t("search.title")}
        </h1>
        {hits && hits.length >= SEARCH_LIMIT && (
          <p className="shrink-0 text-[12px] text-muted">{t("search.limited", { count: hits.length })}</p>
        )}
      </div>
      {error ? (
        <PageMessage title={t(error)} testId="search-error" />
      ) : !hits ? (
        <PageMessage title={t("search.promptTitle")} testId="search-prompt">
          {t("search.prompt")}
        </PageMessage>
      ) : hits.length === 0 ? (
        <PageMessage title={t("search.noResultsTitle", { query })} testId="search-empty">
          {t("search.noResults")}
        </PageMessage>
      ) : (
        <SearchResults key={query} hits={hits} />
      )}
    </div>
  );
}
