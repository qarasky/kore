"use client";
import type { ProviderConnection, Settings } from "@zero/shared";
import { ChevronRight, Star } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { Button, ErrorText, Field } from "@/components/ui";
import { useModelChoice } from "@/lib/contexts";
import { useSession } from "@/lib/session";
import { t } from "@/lib/strings";

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="border-b border-border py-5"><h2 className="mb-3 text-heading font-semibold">{title}</h2><div className="flex flex-col gap-3">{children}</div></section>
);

export default function SettingsPage() {
  const { api, baseUrl, user, signOut } = useSession();
  const { providers, favorites, toggleFavorite, reload } = useModelChoice();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [keyFor, setKeyFor] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [signingIn, setSigningIn] = useState<string | null>(null);

  const loadConnections = async () => { if (api) setConnections(await api.providers().catch(() => [])); };
  useEffect(() => { void loadConnections(); }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { api?.settings().then(setSettings).catch(() => {}); }, [api]);
  const names = Object.fromEntries(providers.flatMap((p) => p.models.map((m) => [`${p.id}/${m.id}`, m.name])));

  async function saveSettings() {
    if (!api || !settings) return;
    setSettings(await api.putSettings(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }
  async function saveKey(id: string) {
    setError("");
    try { await api?.setProviderKey(id, keyFor[id] ?? ""); setKeyFor((k) => ({ ...k, [id]: "" })); await Promise.all([reload(), loadConnections()]); }
    catch (e) { setError(e instanceof Error ? e.message : t.genericError); }
  }
  async function disconnect(id: string) {
    setError("");
    try { await api?.removeProviderKey(id); await Promise.all([reload(), loadConnections()]); }
    catch (e) { setError(e instanceof Error ? e.message : t.genericError); }
  }
  async function signIn(id: string) {
    if (!api) return;
    setError("");
    setSigningIn(id);
    try {
      const start = await api.startSignIn(id);
      window.open(start.url, "_blank", "noopener");
      const until = Date.now() + 5 * 60_000;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 2000));
        const { status } = await api.signInStatus(id, start.attemptId);
        if (status === "complete") { await Promise.all([reload(), loadConnections()]); return; }
        if (status === "failed") { setError(t.signInFailed); return; }
      }
      setError(t.signInFailed);
    } catch (e) { setError(e instanceof Error ? e.message : t.genericError); }
    finally { setSigningIn(null); }
  }

  return (
    <Shell title={t.settings}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-xl px-4 pb-10">
          <Section title={t.backendSection}>
            <p className="break-all text-sub text-muted">{baseUrl}</p>
            <Link href="/connect" className="text-meta text-accent underline">{t.changeServer}</Link>
          </Section>

          <Section title={t.favoritesSection}>
            {favorites.length === 0 && <p className="text-meta text-muted">{t.noFavorites}</p>}
            {favorites.map((k) => (
              <div key={k} className="flex min-h-control items-center justify-between rounded-ui bg-surface px-3">
                <span className="text-sub">{names[k] ?? k}</span>
                <button type="button" aria-label={t.removeFavorite} onClick={() => void toggleFavorite(k)} className="grid size-control-sm place-items-center"><Star size={16} className="fill-accent text-accent" /></button>
              </div>
            ))}
          </Section>

          <Section title={t.providersSection}>
            {connections.map((p) => (
              <div key={p.id} className="flex flex-col gap-2 rounded-ui bg-surface p-3">
                <div className="flex items-center justify-between"><span className="text-sub font-medium">{p.name}</span><span className="text-meta text-muted">{p.connected ? t.connected : p.id === "opencode" ? t.freeTier : t.notConnected}</span></div>
                {p.methods.includes("signin") && !p.connected && (
                  <div className="flex flex-col gap-1">
                    <div><Button onClick={() => void signIn(p.id)} disabled={signingIn === p.id}>{t.signInChatgpt}</Button></div>
                    <p className="text-meta text-muted">{signingIn === p.id ? t.signInWaiting : t.signInSameMachine}</p>
                  </div>
                )}
                {p.methods.includes("key") && (
                  <>
                    <Field label={t.apiKey} type="password" autoComplete="off" value={keyFor[p.id] ?? ""} onChange={(e) => setKeyFor((k) => ({ ...k, [p.id]: e.target.value }))} />
                    <div className="flex gap-2">
                      <Button onClick={() => void saveKey(p.id)} disabled={!keyFor[p.id]}>{t.saveKey}</Button>
                      {p.connected && <Button variant="ghost" onClick={() => void disconnect(p.id)}>{p.methods.includes("signin") ? t.disconnect : t.removeKey}</Button>}
                    </div>
                  </>
                )}
                {!p.methods.includes("key") && p.connected && <div><Button variant="ghost" onClick={() => void disconnect(p.id)}>{t.disconnect}</Button></div>}
              </div>
            ))}
            <ErrorText>{error}</ErrorText>
          </Section>

          <Section title={t.personalization}>
            {settings && (
              <>
                <Field label={t.displayName} value={settings.displayName} onChange={(e) => setSettings({ ...settings, displayName: e.target.value })} />
                <Field label={t.tone} hint={t.toneHint} value={settings.tone} onChange={(e) => setSettings({ ...settings, tone: e.target.value })} />
                <label className="block">
                  <span className="mb-1 block text-meta text-muted">{t.about}</span>
                  <textarea rows={3} value={settings.about} onChange={(e) => setSettings({ ...settings, about: e.target.value })} className="w-full rounded-ui border border-border bg-surface px-3 py-2 text-sub focus:border-accent" />
                </label>
                <div className="flex items-center gap-3"><Button onClick={() => void saveSettings()}>{t.save}</Button>{saved && <span className="text-meta text-muted" role="status">{t.saved}</span>}</div>
              </>
            )}
            <Link href="/settings/memory" className="flex min-h-control items-center justify-between rounded-ui bg-surface px-3 text-sub hover:bg-raised">{t.memory}<ChevronRight size={16} aria-hidden /></Link>
          </Section>

          <Section title={t.account}>
            <p className="text-sub text-muted">{user?.email}</p>
            <div><Button variant="ghost" onClick={() => void signOut()}>{t.signOut}</Button></div>
          </Section>
        </div>
      </div>
    </Shell>
  );
}
