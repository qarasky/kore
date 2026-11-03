"use client";
import type { ProviderInfo } from "@koremind/shared";
import { Card, EmptyState, IconButton, SettingsSection } from "@qarasky/kore-ui";
import { Star } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { fadeUp, spring } from "@/lib/motion";
import { t } from "@/lib/strings";

export function ModelsSection({ providers, favorites, toggleFavorite }: { providers: ProviderInfo[]; favorites: string[]; toggleFavorite(key: string): Promise<void> | void }) {
  const info = new Map<string, { model: string; provider: string }>(providers.flatMap((p) => p.models.map((m): [string, { model: string; provider: string }] => [`${p.id}/${m.id}`, { model: m.name, provider: p.name }])));
  return (
    <SettingsSection title={t.favoritesSection} description={t.modelsHint}>
      <Card>
        {favorites.length === 0 ? (
          <EmptyState icon={<Star />} title={t.noFavoritesTitle} description={t.noFavorites} />
        ) : (
          <ul>
            <AnimatePresence initial={false} mode="popLayout">
              {favorites.map((k) => (
                <motion.li key={k} layout transition={spring} variants={fadeUp} initial="hidden" animate="show" exit="exit" className="flex min-h-row items-center justify-between gap-3 border-b border-border pr-2 pl-4 last:border-b-0">
                  <span className="min-w-0">
                    <span className="block truncate">{info.get(k)?.model ?? k}</span>
                    <span className="block text-meta text-muted">{info.get(k)?.provider}</span>
                  </span>
                  <IconButton label={`${t.removeFavorite}: ${info.get(k)?.model ?? k}`} icon={<Star className="fill-accent text-accent" />} onClick={() => void toggleFavorite(k)} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </Card>
    </SettingsSection>
  );
}
