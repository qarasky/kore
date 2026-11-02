"use client";

import { createContext, useContext } from "react";

export type EditorActions = {
  /** Open the editor for a new event. `day` and `minutes` prefill the start. */
  openNew: (at?: { day: string; minutes: number; durationMinutes?: number }) => void;
};

/** Replaced by the real provider once the event editor exists. */
export const EditorContext = createContext<EditorActions>({ openNew: () => {} });

export function useEditor(): EditorActions {
  return useContext(EditorContext);
}
