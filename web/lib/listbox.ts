/**
 * Pure keyboard and placement logic for the custom `Select` listbox
 * (components/Select.tsx), kept free of React and the DOM for unit tests.
 */

export type ListOption = { label: string; disabled?: boolean };

/**
 * The option index after an arrow/Home/End key from `from` (-1 = none):
 * the nearest enabled option in that direction, staying put at either end
 * (no wrapping). -1 only if no option is enabled.
 */
export function stepIndex(options: readonly ListOption[], from: number, dir: "next" | "prev" | "first" | "last"): number {
  const enabled = (i: number) => i >= 0 && i < options.length && !options[i].disabled;
  const scan = (start: number, step: 1 | -1): number => {
    for (let i = start; i >= 0 && i < options.length; i += step) if (enabled(i)) return i;
    return -1;
  };
  const first = scan(0, 1);
  switch (dir) {
    case "first":
      return first;
    case "last":
      return scan(options.length - 1, -1);
    case "next": {
      if (from < 0) return first;
      const i = scan(from + 1, 1);
      return i === -1 ? (enabled(from) ? from : first) : i;
    }
    case "prev": {
      if (from < 0) return first;
      const i = scan(from - 1, -1);
      return i === -1 ? (enabled(from) ? from : first) : i;
    }
  }
}

const fold = (s: string) => s.toLocaleLowerCase();

/**
 * Type-ahead: the enabled option whose label starts with `query`. A single
 * (or repeated) letter cycles through the matches after `from`; a longer
 * query keeps the current option while it still matches. -1 if none.
 */
export function typeaheadIndex(options: readonly ListOption[], query: string, from: number): number {
  if (!query || options.length === 0) return -1;
  const q = fold(query);
  const repeated = [...q].every((c) => c === q[0]);
  const needle = repeated ? q[0] : q;
  const start = repeated ? from + 1 : Math.max(from, 0);
  const n = options.length;
  for (let k = 0; k < n; k++) {
    const i = (((start + k) % n) + n) % n;
    if (!options[i].disabled && fold(options[i].label).startsWith(needle)) return i;
  }
  return -1;
}

/**
 * Whether a popup of `popupHeight` should open above its trigger: only when
 * it doesn't fit below and there is more room above than below.
 */
export function opensAbove(
  trigger: { top: number; bottom: number },
  popupHeight: number,
  viewportHeight: number,
  margin = 8,
): boolean {
  const below = viewportHeight - trigger.bottom - margin;
  const above = trigger.top - margin;
  return popupHeight > below && above > below;
}
