"use client";
import type { ChatSummary, ProviderInfo } from "@koremind/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { defaultChoice, isChoiceAllowed } from "./model-picker";
import { useSession } from "./session";

// ---- chats list -----------------------------------------------------------
type ChatsCtx = { chats: ChatSummary[]; refresh(): Promise<void>; remove(id: string): Promise<void> };
const ChatsContext = createContext<ChatsCtx | null>(null);
export const useChats = () => { const c = useContext(ChatsContext); if (!c) throw new Error("ChatsProvider missing"); return c; };

export function ChatsProvider({ children }: { children: ReactNode }) {
  const { api } = useSession();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const refresh = useCallback(async () => { if (api) setChats(await api.chats().catch(() => [])); }, [api]);
  useEffect(() => { void refresh(); }, [refresh]);
  const remove = useCallback(async (id: string) => { await api?.deleteChat(id); await refresh(); }, [api, refresh]);
  return <ChatsContext.Provider value={{ chats, refresh, remove }}>{children}</ChatsContext.Provider>;
}

// ---- model choice ---------------------------------------------------------
export type Choice = { providerId: string; modelId: string; thinking?: string };
type ModelCtx = {
  providers: ProviderInfo[];
  favorites: string[];
  choice: Choice | null;
  select(providerId: string, modelId: string): void;
  setThinking(level: string | undefined): void;
  toggleFavorite(key: string): Promise<void>;
  reload(): Promise<void>;
};
const ModelContext = createContext<ModelCtx | null>(null);
export const useModelChoice = () => { const c = useContext(ModelContext); if (!c) throw new Error("ModelChoiceProvider missing"); return c; };
const CHOICE_KEY = "koremind.model";

export function ModelChoiceProvider({ children }: { children: ReactNode }) {
  const { api } = useSession();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [choice, setChoice] = useState<Choice | null>(null);

  const reload = useCallback(async () => {
    if (!api) return;
    const [ps, favs] = await Promise.all([api.models().catch(() => [] as ProviderInfo[]), api.favorites().catch(() => [] as string[])]);
    setProviders(ps);
    setFavorites(favs);
    setChoice((cur) => {
      const stored: Choice | null = cur ?? JSON.parse(localStorage.getItem(CHOICE_KEY) ?? "null");
      if (stored && isChoiceAllowed(ps, stored.providerId, stored.modelId)) return stored;
      return defaultChoice(ps);
    });
  }, [api]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (choice) localStorage.setItem(CHOICE_KEY, JSON.stringify(choice)); }, [choice]);

  const value = useMemo<ModelCtx>(() => ({
    providers, favorites, choice, reload,
    select: (providerId, modelId) => setChoice((c) => {
      const levels = providers.find((p) => p.id === providerId)?.models.find((m) => m.id === modelId)?.thinkingLevels ?? [];
      return { providerId, modelId, thinking: c?.thinking && levels.includes(c.thinking) ? c.thinking : undefined };
    }),
    setThinking: (thinking) => setChoice((c) => (c ? { ...c, thinking } : c)),
    toggleFavorite: async (key) => {
      const next = favorites.includes(key) ? favorites.filter((k) => k !== key) : [...favorites, key];
      setFavorites(next);
      if (api) setFavorites(await api.setFavorites(next).catch(() => favorites));
    },
  }), [providers, favorites, choice, reload, api]);
  return <ModelContext.Provider value={value}>{children}</ModelContext.Provider>;
}
