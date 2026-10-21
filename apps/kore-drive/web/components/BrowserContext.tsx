"use client";

import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Space } from "@/lib/nodes";

/**
 * What the currently mounted file list offers to the app shell (the + New
 * menu, and in task 14 the upload entries): where new things go and how to
 * start creating them. `null` when no folder view is on screen.
 */
export type BrowserHandle = {
  space: Space;
  parentId: string | null;
  newFolder: () => void;
};

type Store = {
  get: () => BrowserHandle | null;
  set: (h: BrowserHandle | null) => void;
  subscribe: (fn: () => void) => () => void;
};

function createStore(): Store {
  let current: BrowserHandle | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (h) => {
      current = h;
      listeners.forEach((fn) => fn());
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

const BrowserContext = createContext<Store | null>(null);

export function BrowserProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createStore);
  return <BrowserContext value={store}>{children}</BrowserContext>;
}

function useStore(): Store {
  const store = useContext(BrowserContext);
  if (!store) throw new Error("BrowserProvider missing");
  return store;
}

/** The mounted file list's handle, or null. */
export function useBrowserHandle(): BrowserHandle | null {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.get, () => null);
}

/** Setter the file list uses to register (and, on unmount, clear) its handle. */
export function useRegisterBrowser(): Store["set"] {
  return useStore().set;
}
