/** The Kore apps a user can switch between (keys match Kore ID's `app` keys). */
export type AppId = "kore" | "koremind" | "korecalendar" | "flatline";

/** Every product that has a mark: the four apps plus Kore ID itself. */
export type ProductId = AppId | "kore-id";

export type AppInfo = { id: ProductId; name: string; description: string };

export const KORE_PRODUCTS: Record<ProductId, AppInfo> = {
  kore: { id: "kore", name: "Kore", description: "Files" },
  koremind: { id: "koremind", name: "KoreMind", description: "Assistant" },
  korecalendar: { id: "korecalendar", name: "KoreCalendar", description: "Calendar" },
  flatline: { id: "flatline", name: "KoreMonitor", description: "Uptime" },
  "kore-id": { id: "kore-id", name: "Kore ID", description: "Account" },
};

/** Switcher order. */
export const KORE_APP_IDS: readonly AppId[] = ["kore", "koremind", "korecalendar", "flatline"];

/** Where each app lives. Apps missing from the map are not shown (e.g. the user has no access). */
export type AppUrls = Partial<Record<AppId, string>>;

/** Override display names, e.g. `{ flatline: "Flatline" }` until the rename ships. */
export type AppNames = Partial<Record<ProductId, string>>;

export function productName(id: ProductId, names?: AppNames): string {
  return names?.[id] ?? KORE_PRODUCTS[id].name;
}
