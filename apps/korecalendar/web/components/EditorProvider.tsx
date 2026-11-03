"use client";

import { useMemo, useState, type ReactNode } from "react";
import { EditorContext, type EditorActions } from "./EditorContext";
import { EventEditor, type EditorMode } from "./EventEditor";
import { EventPopover } from "./EventPopover";
import type { Occurrence } from "@/lib/types";

/** Kept after closing (`open: false`) so the dialog can animate out. */
type Open = { mode: EditorMode; id: number; open: boolean };

/** Owns the event editor and the quick-look popover, and lets any view open them. */
export function EditorProvider({ children }: { children: ReactNode }) {
  const [editor, setEditor] = useState<Open | null>(null);
  const [popover, setPopover] = useState<{ occ: Occurrence; anchor: HTMLElement } | null>(null);

  const actions = useMemo<EditorActions>(() => {
    let n = 0;
    return {
      openNew: (at) => {
        setPopover(null);
        setEditor({ mode: { kind: "new", at }, id: ++n, open: true });
      },
      openOccurrence: (occ, anchor) => {
        if (anchor) setPopover({ occ, anchor });
        else setEditor({ mode: { kind: "edit", occ }, id: ++n, open: true });
      },
    };
  }, []);

  return (
    <EditorContext.Provider value={actions}>
      {children}
      {popover ? (
        <EventPopover
          key={popover.occ.event_id + popover.occ.key}
          occ={popover.occ}
          anchor={popover.anchor}
          onClose={() => setPopover(null)}
          onEdit={() => {
            const occ = popover.occ;
            setPopover(null);
            setEditor({ mode: { kind: "edit", occ }, id: Date.now(), open: true });
          }}
        />
      ) : null}
      {editor ? (
        <EventEditor key={editor.id} mode={editor.mode} open={editor.open} onClose={() => setEditor((e) => (e ? { ...e, open: false } : e))} />
      ) : null}
    </EditorContext.Provider>
  );
}
