import { thinkingLabel } from "./model-picker";
import { t } from "./strings";

/** The stops of the thinking slider: Default first, then the model's levels. */
export const effortStops = (levels: string[]): (string | undefined)[] => [undefined, ...levels];

/** Where the slider sits. A level the model doesn't offer (after switching models) reads as Default. */
export function effortIndex(levels: string[], thinking: string | undefined): number {
  const i = thinking ? levels.indexOf(thinking) : -1;
  return i < 0 ? 0 : i + 1;
}

/** The level at a slider position, clamped to the stops. */
export function effortAt(levels: string[], index: number): string | undefined {
  const stops = effortStops(levels);
  return stops[Math.min(Math.max(Math.round(index), 0), stops.length - 1)];
}

export const effortLabel = (thinking: string | undefined): string => (thinking ? t.effortOf(thinkingLabel(thinking)) : t.effortDefault);
