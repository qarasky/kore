"use client";
import type { ProviderInfo } from "@zero/shared";
import { Star } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Card, SectionHeader } from "./parts";
import { fadeUp, spring } from "@/lib/motion";
import { t } from "@/lib/strings";

export function ModelsSection({ providers, favorites, toggleFavorite }: { providers: ProviderInfo[]; favorites: string[]; toggleFavorite(key: string): Promise<void> | void }) {
  const info = new Map<string, { model: string; provider: string }>(providers.flatMap((p) => p.models.map((m): [string, { model: string; provider: string }] => [`${p.id}/${m.id}`, { model: m.name, provider: p.name }])));
  return (
    <section aria-labelledby="models-h">
      <SectionHeader title={t.sectionModels} hint={t.modelsHint} />
      <h3 id="models-h" className="sr-only">{t.favoritesSection}</h3>
      <Card>
        <ul>
          <AnimatePresence initial={false} mode="popLayout">
            {favorites.map((k) => (
              <motion.li
                key={k} layout transition={spring} variants={fadeUp} initial="hidden" animate="show" exit="exit"
                className="flex min-h-row items-center justify-between border-b border-border px-4 last:border-b-0"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sub">{info.get(k)?.model ?? k}</span>
                  <span className="block text-2xs text-muted">{info.get(k)?.provider}</span>
                </span>
                <button type="button" aria-label={t.removeFavorite} onClick={() => void toggleFavorite(k)} className="grid size-control-sm place-items-center rounded-ui hover:bg-raised">
                  <Star size={16} className="fill-accent text-accent" />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        {favorites.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <Star size={22} className="text-muted" aria-hidden />
            <p className="text-sub font-medium">{t.noFavoritesTitle}</p>
            <p className="text-meta text-muted">{t.noFavorites}</p>
          </div>
        )}
      </Card>
    </section>
  );
}
