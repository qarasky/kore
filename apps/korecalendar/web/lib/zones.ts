import { offsetLabel } from "./tz";

/** All IANA zone names the browser knows, with "UTC" first-class. */
export function allZones(): string[] {
  const zones = new Set<string>(["UTC"]);
  try {
    for (const z of Intl.supportedValuesOf("timeZone")) zones.add(z);
  } catch {
    // very old engines: just UTC and whatever the caller adds
  }
  return [...zones].sort();
}

export type ZoneOption = { value: string; label: string; description: string; keywords: string[] };

/**
 * Combobox options: the zone name ("Europe/Berlin"), its current offset as the hint ("GMT+1"),
 * and the region and city words as search keywords ("Europe", "Berlin"). `extra` (a zone already
 * in use) is always present.
 */
export function zoneOptions(extra: string[], at: Date = new Date()): ZoneOption[] {
  const names = new Set([...allZones(), ...extra.filter(Boolean)]);
  return [...names].sort().map((value) => ({
    value,
    label: value,
    description: offsetLabel(value, at),
    keywords: value.split(/[/_]/),
  }));
}
