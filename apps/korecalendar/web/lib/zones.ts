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

/** Select options "Europe/Berlin (GMT+1)", with `extra` (a zone already in use) always present. */
export function zoneOptions(extra: string[], at: Date = new Date()): { value: string; label: string }[] {
  const names = new Set([...allZones(), ...extra.filter(Boolean)]);
  return [...names].sort().map((value) => ({ value, label: `${value} (${offsetLabel(value, at)})` }));
}
