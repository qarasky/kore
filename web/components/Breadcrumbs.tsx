"use client";

import Link from "next/link";
import { useDropTarget } from "@/hooks/useDropTarget";
import { useMoveNodes } from "@/hooks/useMoveNodes";
import { t } from "@/lib/i18n";
import { activeMove, endMove, isNoopMove } from "@/lib/moveDrag";
import { folderHref, type ApiNode, type Space } from "@/lib/nodes";
import { ChevronRightIcon } from "./icons";

type Crumb = { id: string | null; name: string };

/**
 * Section root, then each folder from `GET /api/nodes/{id}/path`; the last is
 * the current page. Ancestor crumbs accept dragged rows (moving them there).
 */
export function Breadcrumbs({ space, path }: { space: Space; path: ApiNode[] }) {
  const crumbs: Crumb[] = [
    { id: null, name: space === "shared" ? t("nav.shared") : t("nav.myFiles") },
    ...path.map((n) => ({ id: n.id as string | null, name: n.name })),
  ];
  return (
    <nav aria-label={t("breadcrumbs.label")} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-0.5 text-heading">
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
                  className="truncate px-2 py-1 font-semibold text-text"
                >
                  {c.name}
                </span>
              ) : (
                <CrumbLink space={space} crumb={c} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function CrumbLink({ space, crumb }: { space: Space; crumb: Crumb }) {
  const move = useMoveNodes();
  const dest = { space, parentId: crumb.id };
  const drop = useDropTarget<HTMLAnchorElement>({
    accepts: (e) => {
      const p = activeMove(e);
      return p !== null && !isNoopMove(p, dest);
    },
    onDrop: (e) => {
      const p = activeMove(e);
      endMove();
      if (p) void move(p, dest);
    },
  });
  return (
    <Link
      href={folderHref(space, crumb.id)}
      title={crumb.name}
      {...drop.props}
      data-drop-target={drop.active || undefined}
      className={
        "max-w-[220px] truncate rounded-ui px-2 py-1 transition-colors " +
        (drop.active ? "bg-accent/25 text-text ring-2 ring-accent" : "text-muted hover:bg-white/5 hover:text-text")
      }
    >
      {crumb.name}
    </Link>
  );
}
