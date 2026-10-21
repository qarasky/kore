import Link from "next/link";
import { t } from "@/lib/i18n";
import { folderHref, type ApiNode, type Space } from "@/lib/nodes";
import { ChevronRightIcon } from "./icons";

/** Section root, then each folder from `GET /api/nodes/{id}/path`; the last is the current page. */
export function Breadcrumbs({ space, path }: { space: Space; path: ApiNode[] }) {
  const crumbs = [
    { id: null as string | null, name: space === "shared" ? t("nav.shared") : t("nav.myFiles") },
    ...path.map((n) => ({ id: n.id as string | null, name: n.name })),
  ];
  return (
    <nav aria-label={t("breadcrumbs.label")} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-0.5 text-[14px]">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={c.id ?? "root"} className={`flex min-w-0 items-center gap-0.5 ${last ? "" : "shrink"}`}>
              {i > 0 && <ChevronRightIcon className="size-3.5 text-muted" />}
              {last ? (
                <span
                  aria-current="page"
                  data-testid="current-folder"
                  title={c.name}
                  className="truncate px-1.5 py-0.5 font-semibold text-text"
                >
                  {c.name}
                </span>
              ) : (
                <Link
                  href={folderHref(space, c.id)}
                  title={c.name}
                  className="max-w-[200px] truncate rounded-ui px-1.5 py-0.5 text-muted transition-colors hover:bg-white/5 hover:text-text"
                >
                  {c.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
