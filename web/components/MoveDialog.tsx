"use client";

import { Button, Dialog, DialogBody, DialogContent, DialogFooter, Field, Select, Spinner } from "@qarasky/kore-ui";
import { ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api, isApiError } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { MoveDest, MovePayload } from "@/lib/moveDrag";
import { canOpenFolder, destinationProblem, locationDest, spaceLabel } from "@/lib/moveTo";
import type { ApiNode, Space } from "@/lib/nodes";
import { NodeIcon } from "./NodeIcon";

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
 * closes, focus returns to the opener or `returnFocus()`); `onMove` runs the
 * move itself.
 */
export function MoveDialog({
  payload,
  onClose,
  onMove,
  returnFocus,
}: {
  payload: MovePayload;
  onClose: () => void;
  onMove: (dest: MoveDest, destLabel: string) => void;
  /** Where focus goes on close, if not back to the opener. */
  returnFocus?: () => HTMLElement | null | undefined;
}) {
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
      // The clicked folder/crumb usually unmounts (focus falls to <body>, or
      // to the dialog itself, where its focus trap catches it); anything else
      // focused means the user went on: leave it there.
      const active = document.activeElement;
      const fell = active === null || active === document.body || active.getAttribute("role") === "dialog";
      if (fell || active === pending.from) listRef.current?.focus();
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
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        title={<span className="block truncate">{title}</span>}
        aria-describedby={statusId}
        closeLabel={t("dialog.close")}
        onCloseAutoFocus={(e) => {
          const el = returnFocus?.();
          if (el?.isConnected) {
            e.preventDefault();
            el.focus();
          }
        }}
      >
        <DialogBody className="flex flex-col gap-3">
          <Field label={t("move.dialog.space")} className="flex-row items-center gap-3">
            <Select<Space>
              value={space}
              onValueChange={(s) => go([], s, false)}
              options={SPACES.map((s) => ({ value: s, label: spaceLabel(s) }))}
              className="w-auto min-w-[160px]"
            />
          </Field>

          <nav aria-label={t("move.dialog.path")} className="min-w-0">
            <ol className="flex min-w-0 flex-wrap items-center gap-0.5">
              {[{ id: "", name: spaceLabel(space) }, ...path].map((c, i, all) => {
                const last = i === all.length - 1;
                return (
                  <li key={c.id || "root"} className="flex min-w-0 items-center gap-0.5">
                    {i > 0 && <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-muted" />}
                    {last ? (
                      <span aria-current="location" className="truncate px-1.5 py-0.5 font-semibold">
                        {c.name}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => go(path.slice(0, i))}
                        className="truncate rounded-ui px-1.5 py-0.5 text-muted transition-colors hover:bg-white/5 hover:text-text"
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
            className="h-[232px] shrink-0 overflow-auto rounded-ui border border-border bg-bg/60 py-1 outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {folders.state === "loading" && (
              <p className="flex items-center gap-2 px-3 py-2 text-muted">
                <Spinner size={12} />
                {t("move.dialog.loading")}
              </p>
            )}
            {folders.state === "error" && (
              <div role="alert" className="flex items-center gap-3 px-3 py-2">
                <span className="text-danger">{folders.gone ? t("move.dialog.notFound") : t("move.dialog.error")}</span>
                <Button variant="ghost" size="sm" onClick={() => (folders.gone ? go([]) : setAttempt((a) => a + 1))}>
                  {t("move.dialog.retry")}
                </Button>
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
                          "flex min-h-control w-full items-center gap-3 px-3.5 text-left outline-none " +
                          "hover:bg-white/[0.04] focus-visible:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                        }
                      >
                        <NodeIcon kind="folder" />
                        <span className="min-w-0 flex-1 truncate" title={f.name}>
                          {f.name}
                        </span>
                        {open ? (
                          <ChevronRight aria-hidden="true" className="size-3.5 text-muted" />
                        ) : (
                          <span className="text-meta text-muted">{t("move.dialog.moving")}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <p
            id={statusId}
            aria-live="polite"
            className={`min-h-[19px] text-meta ${problem === "inside" || gone ? "text-danger" : "text-muted"}`}
          >
            {problem === "here"
              ? t("move.dialog.alreadyHere")
              : problem === "inside"
                ? t("move.dialog.inside")
                : gone
                  ? t("move.dialog.notFound")
                  : t("move.dialog.here", { location: here })}
          </p>
        </DialogBody>

        <DialogFooter>
          <Button onClick={onClose}>{t("dialog.cancel")}</Button>
          <Button variant="primary" disabled={!canMove} onClick={() => onMove(locationDest(loc), here)}>
            {t("move.dialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
