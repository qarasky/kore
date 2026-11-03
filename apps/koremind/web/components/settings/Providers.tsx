"use client";
import type { ProviderConnection, Settings } from "@koremind/shared";
import { Badge, Button, Card, Field, Input, SettingsSection, StatusDot, Switch, type Status } from "@qarasky/kore-ui";
import { KeyRound } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ProviderIcon } from "@/components/ProviderIcon";
import { InlineError } from "@/components/InlineError";
import { collapse, fadeUp } from "@/lib/motion";
import { freeOnly, providerEnabled, providerStatus, withFreeOnly, withProviderEnabled } from "@/lib/settings-model";
import { useSession } from "@/lib/session";
import { useModelChoice } from "@/lib/contexts";
import { t } from "@/lib/strings";

const STATUS: Record<"on" | "free" | "off", { label: string; dot: Status }> = { on: { label: t.connected, dot: "up" }, free: { label: t.freeTier, dot: "warn" }, off: { label: t.notConnected, dot: "off" } };

export function ProvidersSection({ settings, onChange }: { settings: Settings | null; onChange(s: Settings): void }) {
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
    <SettingsSection title={t.sectionProviders} description={t.providersHint}>
      <ul className="flex flex-col gap-3">
        {list.map((p) => {
          const state = providerStatus(p);
          const open = keyOpen === p.id;
          const canKey = p.methods.includes("key");
          const canSignIn = p.methods.includes("signin") && !p.connected;
          return (
            <motion.li key={p.id} variants={fadeUp} initial="hidden" animate="show">
              <Card className="p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-control shrink-0 place-items-center rounded-ui border border-border bg-bg/60 text-text" aria-hidden><ProviderIcon id={p.id} name={p.name} size={20} /></span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium"><span className="truncate">{p.name}</span>{p.recommended && <Badge tone="accent">{t.recommended}</Badge>}</p>
                    <StatusDot status={STATUS[state].dot} label={STATUS[state].label} tintLabel={false} className="text-meta text-muted" />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {canSignIn && <Button variant="primary" size="sm" loading={signing === p.id} onClick={() => void signIn(p.id)}>{t.signInChatgpt}</Button>}
                  {canKey && <Button size="sm" aria-expanded={open} onClick={() => setKeyOpen(open ? null : p.id)}><KeyRound aria-hidden />{open ? t.hideKey : p.connected ? t.replaceKey : t.addKey}</Button>}
                  {p.connected && <Button size="sm" variant="danger-outline" onClick={() => void disconnect(p.id)}>{t.disconnect}</Button>}
                </div>

                {settings && (
                  <div className="mt-3 border-t border-border pt-2">
                    <Switch labelFirst label={t.useInPicker} aria-label={`${t.useInPicker}: ${p.name}`} checked={providerEnabled(settings, p.id)} onCheckedChange={(v) => onChange(withProviderEnabled(settings, p.id, v))} />
                    {p.supportsFreeFilter && (
                      <Switch labelFirst label={t.onlyFreeModels} description={t.onlyFreeHint} aria-label={`${t.onlyFreeModels}: ${p.name}`} checked={freeOnly(settings, p.id)} onCheckedChange={(v) => onChange(withFreeOnly(settings, p.id, v))} />
                    )}
                  </div>
                )}

                <AnimatePresence initial={false}>
                  {signing === p.id && (
                    <motion.p variants={collapse} initial="hidden" animate="show" exit="exit" className="overflow-hidden text-meta text-muted" role="status">
                      <span className="block pt-3">{t.signInWaiting}</span>
                    </motion.p>
                  )}
                  {canSignIn && signing !== p.id && !open && (
                    <motion.p variants={collapse} initial="hidden" animate="show" exit="exit" className="overflow-hidden text-meta text-muted">
                      <span className="block pt-3">{t.signInSameMachine}</span>
                    </motion.p>
                  )}
                  {open && (
                    <motion.form
                      variants={collapse} initial="hidden" animate="show" exit="exit" className="overflow-hidden"
                      onSubmit={(e) => { e.preventDefault(); if (keys[p.id]) void saveKey(p.id); }}
                    >
                      <div className="flex items-end gap-2 pt-4">
                        <Field label={t.apiKey} className="flex-1"><Input type="password" autoComplete="off" autoFocus value={keys[p.id] ?? ""} onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))} /></Field>
                        <Button type="submit" variant="primary" disabled={!keys[p.id]}>{t.saveKey}</Button>
                      </div>
                    </motion.form>
                  )}
                </AnimatePresence>
              </Card>
            </motion.li>
          );
        })}
      </ul>
      <InlineError>{error}</InlineError>
    </SettingsSection>
  );
}
