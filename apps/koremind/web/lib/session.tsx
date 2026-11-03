"use client";
import type { AuthResponse, Health, User } from "@koremind/shared";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createApi, type Api } from "./api";
import { normalizeBackendUrl } from "./backend-url";

const URL_KEY = "koremind.backendUrl";
const TOKEN_KEY = "koremind.token";

type Ctx = {
  ready: boolean;
  api: Api | null;
  user: User | null;
  baseUrl: string | null;
  /** The server's /health: Kore ID on/off, password sign-in, the Kore ID account page, other Kore apps. Null until loaded. */
  server: Health | null;
  /** Re-reads /health (after setup, when the owner exists). */
  reloadServer(): Promise<Health | null>;
  setBaseUrl(url: string): void;
  signedIn(r: AuthResponse): void;
  signOut(): Promise<void>;
};
const SessionCtx = createContext<Ctx | null>(null);
export const useSession = () => {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("SessionProvider missing");
  return c;
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [baseUrl, setBase] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [server, setServer] = useState<Health | null>(null);
  const router = useRouter();
  const path = usePathname();

  const api = useMemo(() => (baseUrl ? createApi(baseUrl, () => localStorage.getItem(TOKEN_KEY)) : null), [baseUrl]);

  useEffect(() => {
    (async () => {
      let url = localStorage.getItem(URL_KEY);
      if (!url) {
        // The web UI runs on the same machine as the backend: try that first so there is nothing to configure.
        const guess = normalizeBackendUrl(`${location.hostname}:8787`);
        if (guess) { try { const r = await fetch(guess + "/health"); if (r.ok) { url = guess; localStorage.setItem(URL_KEY, guess); } } catch { /* ask the user */ } }
      }
      const tk = localStorage.getItem(TOKEN_KEY);
      setBase(url);
      setToken(tk);
      if (url && tk) {
        try { setUser(await createApi(url, () => tk).me()); } catch { localStorage.removeItem(TOKEN_KEY); setToken(null); }
      }
      setReady(true);
    })();
  }, []);

  const reloadServer = useCallback(async () => {
    const h = api ? await api.health().catch(() => null) : null;
    setServer(h);
    return h;
  }, [api]);
  useEffect(() => { void reloadServer(); }, [reloadServer]);

  useEffect(() => {
    if (!ready) return;
    if (!baseUrl) { if (path !== "/connect") router.replace("/connect"); }
    else if (!user) { if (path !== "/login" && path !== "/connect") router.replace("/login"); }
  }, [ready, baseUrl, user, path, router]);

  const value: Ctx = {
    ready, api, user, baseUrl, server, reloadServer,
    setBaseUrl: useCallback((u: string) => { localStorage.setItem(URL_KEY, u); localStorage.removeItem(TOKEN_KEY); setToken(null); setUser(null); setBase(u); }, []),
    signedIn: useCallback((r: AuthResponse) => { localStorage.setItem(TOKEN_KEY, r.token); setToken(r.token); setUser(r.user); }, []),
    signOut: useCallback(async () => {
      let logoutUrl: string | undefined;
      try { logoutUrl = (await api?.logout())?.logoutUrl; } catch { /* already gone */ }
      localStorage.removeItem(TOKEN_KEY); setToken(null); setUser(null);
      // Signed in with Kore ID: also end the Kore ID session (RP-initiated logout), which sends the browser back to /login.
      if (logoutUrl) location.assign(logoutUrl); else router.replace("/login");
    }, [api, router]),
  };
  void token;
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
