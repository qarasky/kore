"use client";

import { useEffect, useId, useRef, useState } from "react";
import { api, isApiError } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { MoveDest, MovePayload } from "@/lib/moveDrag";
import { canOpenFolder, destinationProblem, locationDest, spaceLabel } from "@/lib/moveTo";
import type { ApiNode, Space } from "@/lib/nodes";
import { ChevronRightIcon, NodeIcon } from "./icons";
import { Modal } from "./Modal";
import { Select } from "./Select";

type Crumb = { id: string; name: string };
type Folders =
  | { state: "loading" }
  | { state: "error"; gone: boolean }
  | { state: "ready"; folders: ApiNode[] };

const SPACES: Space[] = ["personal", "shared"];

/**
 * "Move to…": pick a destination space and browse its folders (children are
 * loaded on demand from `GET /api/nodes?space=&parent=`, folders only), then
 * "Move here". Where the items already are, and the moved folders and
 * anything inside them, can't be chosen. A modal (focus trapped, Escape
 * closes, focus returns to the opener); `onMove` runs the move itself.
 */
export function MoveDialog({
  payload,
  onClose,
  onMove,
}: {
  payload: MovePayload;
  onClose: () => void;
  onMove: (dest: MoveDest, destLabel: string) => void;
}) {
  const titleId = useId();
  const spaceId = useId();
  const statusId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState<Space>(payload.space);
  const [path, setPath] = useState<Crumb[]>([]);
  const [attempt, setAttempt] = useState(0);
  /** The last load result and which location (and attempt) it is for. */
  const [loaded, setLoaded] = useState<{ key: string; result: Folders } | null>(null);
  /** After folder/breadcrumb navigation (not on first open, not after a
   *  Space change): the control that triggered it, so the folder list can
   *  take focus once loaded, unless the user has moved focus meanwhile. */
  const focusList = useRef<{ from: Element | null } | null>(null);

  const parent = path.length > 0 ? path[path.length - 1].id : null;
  const key = `${space}/${parent ?? ""}#${attempt}`;
  const folders: Folders = loaded?.key === key ? loaded.result : { state: "loading" };

  useEffect(() => {
    const ctl = new AbortController();
    // Only names are needed here: skip the folder size totals.
    const q = new URLSearchParams({ space, sizes: "0" });
    if (parent) q.set("parent", parent);
    api<ApiNode[]>(`/api/nodes?${q}`, { signal: ctl.signal })
      .then((nodes) => setLoaded({ key, result: { state: "ready", folders: nodes.filter((n) => n.is_dir) } }))
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        setLoaded({ key, result: { state: "error", gone: isApiError(e, 404) } });
      });
    return () => ctl.abort();
  }, [space, parent, key]);

  useEffect(() => {
    const pending = focusList.current;
    if (pending && folders.state !== "loading") {
      focusList.current = null;
      // The clicked folder/crumb usually unmounts (focus falls to <body>);
      // anything else focused means the user went on: leave it there.
      const active = document.activeElement;
      if (active === null || active === document.body || active === pending.from) listRef.current?.focus();
    }
  }, [folders.state, key]);

  /** Shows `next` in `nextSpace`. `moveFocus`: hand focus to the folder
   *  list once loaded (folder and breadcrumb navigation; not the Space
   *  select, which keeps focus where the user is). */
  function go(next: Crumb[], nextSpace: Space = space, moveFocus = true) {
    focusList.current = moveFocus ? { from: document.activeElement } : null;
    setSpace(nextSpace);
    setPath(next);
  }

  const loc = { space, path: path.map((c) => c.id) };
  const problem = destinationProblem(payload, loc);
  const here = path.length > 0 ? path[path.length - 1].name : spaceLabel(space);
  const gone = folders.state === "error" && folders.gone;
  const canMove = problem === null && !gone;

  const count = payload.ids.length;
  const title =
    count === 1
      ? t("move.dialog.titleOne", { name: payload.names[payload.ids[0]] ?? "" })
      : t("move.dialog.titleMany", { count });

  return (
    <Modal labelledBy={titleId} describedBy={statusId} onClose={onClose} className="w-[min(480px,calc(100vw-32px))]">
      <div className="flex flex-col gap-3 p-5">
        <h2 id={titleId} className="truncate text-[15px] font-semibold tracking-[-0.01em]">
          {title}
        </h2>

        <div className="flex items-center gap-3">
          <span id={spaceId} className="text-[12px] font-medium text-muted">
            {t("move.dialog.space")}
          </span>
          <Select<Space>
            aria-labelledby={spaceId}
            value={space}
            onChange={(s) => go([], s, false)}
            options={SPACES.map((s) => ({ value: s, label: spaceLabel(s) }))}
            className="min-w-[160px]"
          />
        </div>

        <nav aria-label={t("move.dialog.path")} className="min-w-0">
          <ol className="flex min-w-0 flex-wrap items-center gap-0.5">
            {[{ id: "", name: spaceLabel(space) }, ...path].map((c, i, all) => {
              const last = i === all.length - 1;
              return (
                <li key={c.id || "root"} className="flex min-w-0 items-center gap-0.5">
                  {i > 0 && <ChevronRightIcon className="size-3 text-muted" />}
                  {last ? (
                    <span aria-current="location" className="truncate px-1.5 py-0.5 font-semibold">
                      {c.name}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => go(path.slice(0, i))}
                      className="truncate rounded-ui px-1.5 py-0.5 text-muted hover:bg-white/5 hover:text-text"
                    >
                      {c.name}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <div
          ref={listRef}
          role="group"
          aria-label={t("move.dialog.folders")}
          aria-busy={folders.state === "loading" || undefined}
          tabIndex={-1}
          data-testid="move-folders"
          className="h-[232px] overflow-auto rounded-ui border border-border bg-bg/60 py-1 outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {folders.state === "loading" && (
            <p className="flex items-center gap-2 px-3 py-2 text-muted">
              <span aria-hidden="true" className="size-3 animate-spin rounded-full border-[1.5px] border-muted border-t-transparent" />
              {t("move.dialog.loading")}
            </p>
          )}
          {folders.state === "error" && (
            <div role="alert" className="flex items-center gap-3 px-3 py-2">
              <span className="text-danger">{folders.gone ? t("move.dialog.notFound") : t("move.dialog.error")}</span>
              <button
                type="button"
                onClick={() => (folders.gone ? go([]) : setAttempt((a) => a + 1))}
                className="rounded-ui px-2 py-1 font-medium text-accent hover:bg-accent/10"
              >
                {t("move.dialog.retry")}
              </button>
            </div>
          )}
          {folders.state === "ready" && folders.folders.length === 0 && (
            <p className="px-3 py-2 text-muted">{t("move.dialog.empty")}</p>
          )}
          {folders.state === "ready" && folders.folders.length > 0 && (
            <ul>
              {folders.folders.map((f) => {
                const open = canOpenFolder(payload, f.id);
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      disabled={!open}
                      aria-label={t("move.dialog.open", { name: f.name })}
                      onClick={() => go([...path, { id: f.id, name: f.name }])}
                      className={
                        "flex w-full items-center gap-2.5 px-3 py-1.5 text-left outline-none " +
                        "hover:bg-white/[0.04] focus-visible:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                      }
                    >
                      <NodeIcon kind="folder" />
                      <span className="min-w-0 flex-1 truncate" title={f.name}>
                        {f.name}
                      </span>
                      {open ? (
                        <ChevronRightIcon className="size-3.5 text-muted" />
                      ) : (
                        <span className="text-[12px] text-muted">{t("move.dialog.moving")}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p id={statusId} aria-live="polite" className={`min-h-[19px] text-[12px] ${problem === "inside" || gone ? "text-danger" : "text-muted"}`}>
          {problem === "here"
            ? t("move.dialog.alreadyHere")
            : problem === "inside"
              ? t("move.dialog.inside")
              : gone
                ? t("move.dialog.notFound")
                : t("move.dialog.here", { location: here })}
        </p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-ui border border-border-strong px-3.5 py-1.5 font-medium hover:bg-white/5"
          >
            {t("dialog.cancel")}
          </button>
          <button
            type="button"
            disabled={!canMove}
            onClick={() => onMove(locationDest(loc), here)}
            className="rounded-ui bg-accent px-3.5 py-1.5 font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("move.dialog.submit")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
