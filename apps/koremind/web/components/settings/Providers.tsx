"use client";
import type { ProviderConnection } from "@zero/shared";
import { KeyRound, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Card, SectionHeader } from "./parts";
import { Button, ErrorText, Field } from "@/components/ui";
import { collapse, fadeUp } from "@/lib/motion";
import { providerStatus } from "@/lib/settings-model";
import { useSession } from "@/lib/session";
import { useModelChoice } from "@/lib/contexts";
import { t } from "@/lib/strings";

const STATUS = { on: t.connected, free: t.freeTier, off: t.notConnected } as const;

export function ProvidersSection() {
  const { api } = useSession();
  const { reload } = useModelChoice();
  const [list, setList] = useState<ProviderConnection[]>([]);
  const [keyOpen, setKeyOpen] = useState<string | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [signing, setSigning] = useState<string | null>(null);
  const [error, setError] = useState("");
  const cancelled = useRef(false);

  const load = async () => { if (api) setList(await api.providers().catch(() => [])); };
  useEffect(() => { void load(); return () => { cancelled.current = true; }; }, [api]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => Promise.all([reload(), load()]);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : t.genericError);

  async function saveKey(id: string) {
    setError("");
    try { await api?.setProviderKey(id, keys[id] ?? ""); setKeys((k) => ({ ...k, [id]: "" })); setKeyOpen(null); await refresh(); } catch (e) { fail(e); }
  }
  async function disconnect(id: string) {
    setError("");
    try { await api?.removeProviderKey(id); await refresh(); } catch (e) { fail(e); }
  }
  async function signIn(id: string) {
    if (!api) return;
    setError("");
    setSigning(id);
    try {
      const start = await api.startSignIn(id);
      window.open(start.url, "_blank", "noopener");
      const until = Date.now() + 5 * 60_000;
      while (Date.now() < until && !cancelled.current) {
        await new Promise((r) => setTimeout(r, 2000));
        const { status } = await api.signInStatus(id, start.attemptId);
        if (status === "complete") { await refresh(); return; }
        if (status === "failed") { setError(t.signInFailed); return; }
      }
      if (!cancelled.current) setError(t.signInFailed);
    } catch (e) { fail(e); } finally { setSigning(null); }
  }

  return (
    <section>
      <SectionHeader title={t.sectionProviders} hint={t.providersHint} />
      <ul className="flex flex-col gap-3">
        {list.map((p) => {
          const state = providerStatus(p);
          const open = keyOpen === p.id;
          const canKey = p.methods.includes("key");
          const canSignIn = p.methods.includes("signin") && !p.connected;
          return (
            <motion.li key={p.id} variants={fadeUp} initial="hidden" animate="show">
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-ui bg-raised text-sub font-semibold uppercase" aria-hidden>{p.name.slice(0, 1)}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sub font-medium">{p.name}</p>
                      <p className="flex items-center gap-1.5 text-meta text-muted">
                        <span className={`size-1.5 rounded-full ${state === "on" ? "bg-accent" : state === "free" ? "bg-warning" : "bg-border-strong"}`} aria-hidden />
                        {STATUS[state]}
                      </p>
                    </div>
                  </div>
                </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {canSignIn && (
                      <Button onClick={() => void signIn(p.id)} disabled={signing === p.id} className="flex items-center gap-2">
                        {signing === p.id && <Loader2 size={14} className="animate-spin" aria-hidden />}
                        {t.signInChatgpt}
                      </Button>
                    )}
                    {canKey && (
                      <Button variant="ghost" aria-expanded={open} onClick={() => setKeyOpen(open ? null : p.id)} className="flex items-center gap-2">
                        <KeyRound size={14} aria-hidden />{open ? t.hideKey : p.connected ? t.replaceKey : t.addKey}
                      </Button>
                    )}
                    {p.connected && <Button variant="ghost" onClick={() => void disconnect(p.id)}>{t.disconnect}</Button>}
                  </div>

                <AnimatePresence initial={false}>
                  {signing === p.id && (
                    <motion.p variants={collapse} initial="hidden" animate="show" exit="exit" className="overflow-hidden text-meta text-muted" role="status">
                      <span className="block pt-3">{t.signInWaiting}</span>
                    </motion.p>
                  )}
                  {canSignIn && signing !== p.id && !open && (
                    <motion.p variants={collapse} initial="hidden" animate="show" exit="exit" className="overflow-hidden text-2xs text-muted">
                      <span className="block pt-3">{t.signInSameMachine}</span>
                    </motion.p>
                  )}
                  {open && (
                    <motion.form
                      variants={collapse} initial="hidden" animate="show" exit="exit" className="overflow-hidden"
                      onSubmit={(e) => { e.preventDefault(); if (keys[p.id]) void saveKey(p.id); }}
                    >
                      <div className="flex items-end gap-2 pt-4">
                        <div className="flex-1"><Field label={t.apiKey} type="password" autoComplete="off" autoFocus value={keys[p.id] ?? ""} onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))} /></div>
                        <Button type="submit" disabled={!keys[p.id]}>{t.saveKey}</Button>
                      </div>
                    </motion.form>
                  )}
                </AnimatePresence>
              </Card>
            </motion.li>
          );
        })}
      </ul>
      <div className="mt-3"><ErrorText>{error}</ErrorText></div>
    </section>
  );
}
