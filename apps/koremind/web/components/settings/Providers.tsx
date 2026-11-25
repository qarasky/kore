"use client";
import type { ProviderConnection, Settings } from "@koremind/shared";
import { Card, SettingsSection, StatusDot, Switch, type Status } from "@qarasky/kore-ui";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { ProviderIcon } from "@/components/ProviderIcon";
import { fadeUp } from "@/lib/motion";
import { freeOnly, providerEnabled, providerStatus, withFreeOnly, withProviderEnabled } from "@/lib/settings-model";
import { useSession } from "@/lib/session";
import { t } from "@/lib/strings";

const STATUS: Record<"on" | "free" | "off", { label: string; dot: Status }> = { on: { label: t.signedInOnServer, dot: "up" }, free: { label: t.freeTier, dot: "warn" }, off: { label: t.notSignedInOnServer, dot: "off" } };

/** Providers are set up and signed in on the server; here each one shows its status and the per-person switches. */
export function ProvidersSection({ settings, onChange }: { settings: Settings | null; onChange(s: Settings): void }) {
  const { api } = useSession();
  const [list, setList] = useState<ProviderConnection[]>([]);

  useEffect(() => { if (api) void api.providers().then(setList).catch(() => setList([])); }, [api]);

  return (
    <SettingsSection title={t.sectionProviders} description={t.providersHint}>
      <ul className="flex flex-col gap-3">
        {list.map((p) => {
          const state = providerStatus(p);
          return (
            <motion.li key={p.id} variants={fadeUp} initial="hidden" animate="show">
              <Card className="p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-control shrink-0 place-items-center rounded-ui border border-border bg-bg/60 text-text" aria-hidden><ProviderIcon id={p.id} name={p.name} size={20} /></span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    <StatusDot status={STATUS[state].dot} label={STATUS[state].label} tintLabel={false} className="text-meta text-muted" />
                  </div>
                </div>

                {!p.connected && p.hint && <p className="mt-3 text-meta text-muted">{p.hint}</p>}

                {settings && (
                  <div className="mt-3 border-t border-border pt-2">
                    <Switch labelFirst label={t.useInPicker} aria-label={`${t.useInPicker}: ${p.name}`} checked={providerEnabled(settings, p.id)} onCheckedChange={(v) => onChange(withProviderEnabled(settings, p.id, v))} />
                    {p.supportsFreeFilter && (
                      <Switch labelFirst label={t.onlyFreeModels} description={t.onlyFreeHint} aria-label={`${t.onlyFreeModels}: ${p.name}`} checked={freeOnly(settings, p.id)} onCheckedChange={(v) => onChange(withFreeOnly(settings, p.id, v))} />
                    )}
                  </div>
                )}
              </Card>
            </motion.li>
          );
        })}
      </ul>
    </SettingsSection>
  );
}
