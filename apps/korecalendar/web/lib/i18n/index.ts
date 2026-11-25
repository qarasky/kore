/**
 * Translation entry point. All components get their strings through `t()`.
 *
 * Adding a locale (e.g. Russian):
 *   1. Create `ru.ts` exporting `const ru: Messages = { ... }` (the type forces
 *      every key from `en.ts` to be present).
 *   2. Register it in `dictionaries` below and extend `Locale`.
 *   3. Resolve the active locale (cookie / Accept-Language) in `activeLocale()`;
 *      `t()` and `<html lang>` read from there, so nothing else changes.
 */
import en from "./en";

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
export type Locale = "en";

export const DEFAULT_LOCALE: Locale = "en";

const dictionaries: Record<Locale, Messages> = { en };

/** The locale used for rendering. English only for now. */
export function activeLocale(): Locale {
  return DEFAULT_LOCALE;
}

export function dictionary(locale: Locale = activeLocale()): Messages {
  return dictionaries[locale];
}

/** Looks up `key` and fills `{placeholders}` from `vars`. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const template = dictionary()[key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
