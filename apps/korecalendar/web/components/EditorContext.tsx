"use client";

import { createContext, useContext } from "react";

import type { Occurrence } from "@/lib/types";

export type EditorActions = {
  /** Open the editor for a new event. `day` and `minutes` prefill the start. */
  openNew: (at?: { day: string; minutes: number; durationMinutes?: number; allDay?: boolean }) => void;
  /** Show an occurrence (quick view, from where it was clicked). */
  openOccurrence: (occ: Occurrence, anchor: HTMLElement | null) => void;
};

/** Replaced by the real provider once the event editor exists. */
export const EditorContext = createContext<EditorActions>({ openNew: () => {}, openOccurrence: () => {} });

export function useEditor(): EditorActions {
  return useContext(EditorContext);
}
