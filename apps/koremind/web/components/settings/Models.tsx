"use client";
import type { ProviderInfo } from "@koremind/shared";
import { Card, CardList, EmptyState, IconButton, SettingsSection } from "@qarasky/kore-ui";
import { Star } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { fadeUp, spring } from "@/lib/motion";
import { t } from "@/lib/strings";
import { MotionRow } from "./MotionRow";

export function ModelsSection({ providers, favorites, toggleFavorite }: { providers: ProviderInfo[]; favorites: string[]; toggleFavorite(key: string): Promise<void> | void }) {
  const info = new Map<string, { model: string; provider: string }>(providers.flatMap((p) => p.models.map((m): [string, { model: string; provider: string }] => [`${p.id}/${m.id}`, { model: m.name, provider: p.name }])));
  return (
    <SettingsSection title={t.favoritesSection} description={t.modelsHint}>
      {favorites.length === 0 ? (
        <Card><EmptyState icon={<Star />} title={t.noFavoritesTitle} description={t.noFavorites} /></Card>
      ) : (
        <CardList>
          <AnimatePresence initial={false} mode="popLayout">
            {favorites.map((k) => (
              <MotionRow
                key={k} layout transition={spring} variants={fadeUp} initial="hidden" animate="show" exit="exit"
                label={info.get(k)?.model ?? k} description={info.get(k)?.provider}
                actions={<IconButton label={`${t.removeFavorite}: ${info.get(k)?.model ?? k}`} icon={<Star className="fill-accent text-accent" />} onClick={() => void toggleFavorite(k)} />}
              />
            ))}
          </AnimatePresence>
        </CardList>
      )}
    </SettingsSection>
  );
}
