import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KoreProvider } from "../lib/KoreProvider";
import { ThemeProvider, useTheme } from "../lib/ThemeProvider";
import {
  KORE_THEME,
  KORE_THEME_COLOR,
  KORE_THEMES,
  THEME_IDS,
  koreThemeColor,
  themeInitScript,
  type ThemeId,
  type ThemePalette,
} from "../lib/theme";
import { ThemeSwitcher } from "./ThemeSwitcher";

const themeCss = readFileSync("theme.css", "utf8") /* vitest runs from the repo root */;

/** The declarations of `[data-theme="x"] { … }`, or "" for the default (Color) theme. */
function overrides(theme: ThemeId): string {
  if (theme === "color") return "";
  const match = themeCss.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`));
  if (!match?.[1]) throw new Error(`no [data-theme="${theme}"] block in theme.css`);
  return match[1];
}

/** The value of a token in a theme: its override, else the default. */
function token(theme: ThemeId, name: string): string {
  const own = overrides(theme).match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (own?.[1]) return own[1].trim();
  const base = themeCss.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!base?.[1]) throw new Error(`--${name} is not in theme.css`);
  return base[1].trim();
}

const TOKENS: Record<keyof ThemePalette, string> = {
  bg: "color-bg",
  surface: "color-surface",
  raised: "color-raised",
  border: "color-border",
  borderStrong: "color-border-strong",
  text: "color-text",
  muted: "color-muted",
  accent: "color-accent",
  accentFg: "color-accent-fg",
  danger: "color-danger",
  warning: "color-warning",
  statusUp: "color-status-up",
  statusWarn: "color-status-warn",
  statusDown: "color-status-down",
  statusMaint: "color-status-maint",
  statusOff: "color-status-off",
};

describe("themes in theme.css and KORE_THEMES", () => {
  it.each(THEME_IDS)("%s: the hex palette equals the CSS tokens", (theme) => {
    for (const [key, name] of Object.entries(TOKENS)) {
      expect(KORE_THEMES[theme][key as keyof ThemePalette], `${theme}.${key}`).toBe(token(theme, name));
    }
  });

  it("keeps the old single-theme exports pointing at Color", () => {
    expect(KORE_THEME).toBe(KORE_THEMES.color);
    expect(KORE_THEME_COLOR).toBe(token("color", "color-bg"));
    expect(koreThemeColor("dark")).toBe("#000000");
    expect(koreThemeColor("light")).toBe("#f7f8fa");
  });

  it("every theme defines the tokens that differ, and Dark inherits the rest from Color", () => {
    expect(token("dark", "color-bg")).toBe("#000000");
    expect(token("dark", "color-accent")).toBe(token("color", "color-accent"));
    expect(token("dark", "color-status-up")).toBe(token("color", "color-status-up"));
    expect(token("light", "color-accent")).toBe(token("color", "color-accent")); // the accent is shared
    expect(overrides("light")).toContain("color-scheme: light");
    expect(overrides("dark")).toContain("color-scheme: dark");
  });

  it("flips the interaction overlays to black tints in Light and keeps white tints elsewhere", () => {
    expect(token("light", "color-hover")).toContain("rgb(0 0 0");
    expect(token("color", "color-hover")).toContain("rgb(255 255 255");
    expect(token("dark", "color-hover")).toContain("rgb(255 255 255");
  });
});

/* ---- Contrast: WCAG AA for every text pairing, in every theme. ---- */

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const luminance = ([r, g, b]: [number, number, number]) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const mixOver = (fg: string, bg: string, alpha: number) => rgb(fg).map((v, i) => v * alpha + rgb(bg)[i]! * (1 - alpha)) as [number, number, number];
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe.each(THEME_IDS)("contrast in the %s theme", (theme) => {
  const p = KORE_THEMES[theme];
  const surfaces = ["bg", "surface", "raised"] as const;

  it("body and secondary text reach 4.5:1 on every surface", () => {
    for (const s of surfaces) {
      for (const fg of ["text", "muted"] as const) {
        expect(contrast(rgb(p[fg]), rgb(p[s])), `${fg} on ${s}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("accent text, and the semantic colours used as text, reach 4.5:1 on every surface", () => {
    for (const s of surfaces) {
      for (const fg of ["accentFg", "danger", "warning", "statusUp", "statusWarn", "statusMaint"] as const) {
        expect(contrast(rgb(p[fg]), rgb(p[s])), `${fg} on ${s}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("the down diamond and the accent line reach 3:1 as graphics", () => {
    for (const s of surfaces) {
      expect(contrast(rgb(p.statusDown), rgb(p[s])), `statusDown on ${s}`).toBeGreaterThanOrEqual(3);
      expect(contrast(rgb(p.accent), rgb(p[s])), `accent on ${s}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("text and the tone colour stay readable on Alert's tinted fills", () => {
    for (const tone of ["statusUp", "warning", "danger"] as const) {
      const fill = mixOver(p[tone], p.surface, 0.1);
      expect(contrast(rgb(p.text), fill), `text on ${tone} fill`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgb(p[tone]), fill), `${tone} on its own fill`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("white on the accent fill reaches 3:1 (large or bold text, icons), the same in every theme", () => {
    expect(contrast([255, 255, 255], rgb(p.accent))).toBeGreaterThanOrEqual(3);
  });
});

/* ---- Behaviour ---- */

function mockMatchMedia(light: boolean) {
  const listeners = new Set<() => void>();
  const state = { light };
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    get matches() {
      return query.includes("light") ? state.light : !state.light;
    },
    media: query,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
  return {
    set(next: boolean) {
      state.light = next;
      listeners.forEach((cb) => cb());
    },
  };
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.head.innerHTML = "";
  mockMatchMedia(false);
});
afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

function Probe() {
  const { theme, preference, setTheme } = useTheme();
  return (
    <div>
      <p data-testid="state">{`${theme}|${preference}`}</p>
      <button type="button" onClick={() => setTheme("light")}>
        to light
      </button>
      <button type="button" onClick={() => setTheme("system")}>
        to system
      </button>
    </div>
  );
}

describe("ThemeProvider", () => {
  it("keeps the Color theme by default and marks <html>", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("state")).toHaveTextContent("color|color");
    expect(document.documentElement).toHaveAttribute("data-theme", "color");
  });

  it("switches the theme, stores it and reports it", async () => {
    const onThemeChange = vi.fn();
    render(
      <ThemeProvider onThemeChange={onThemeChange}>
        <Probe />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "to light" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(localStorage.getItem("kore-theme")).toBe("light");
    expect(onThemeChange).toHaveBeenCalledWith("light");
  });

  it("restores a stored choice and ignores junk", () => {
    localStorage.setItem("kore-theme", "dark");
    const { unmount } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("state")).toHaveTextContent("dark|dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    unmount();
    localStorage.setItem("kore-theme", "neon");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("state")).toHaveTextContent("color|color");
  });

  it("follows the operating system while the choice is System", async () => {
    const media = mockMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "to system" }));
    expect(screen.getByTestId("state")).toHaveTextContent("light|system");
    act(() => media.set(false));
    expect(screen.getByTestId("state")).toHaveTextContent("color|system");
  });

  it("can send a dark OS to the Dark theme instead of Color", async () => {
    mockMatchMedia(false);
    render(
      <ThemeProvider defaultTheme="system" systemDarkTheme="dark">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("state")).toHaveTextContent("dark|system");
  });

  it("does not write storage when told not to, and syncs from other tabs when it does", async () => {
    const { unmount } = render(
      <ThemeProvider storageKey={false}>
        <Probe />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "to light" }));
    expect(localStorage.length).toBe(0);
    unmount();

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "kore-theme", newValue: "dark" }));
    });
    expect(screen.getByTestId("state")).toHaveTextContent("dark|dark");
  });

  it("keeps <meta name=theme-color> in step", async () => {
    document.head.innerHTML = '<meta name="theme-color" content="#16181d">';
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "to light" }));
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute("content", "#f7f8fa");
  });

  it("useTheme outside a provider reports Color and does nothing", () => {
    render(<Probe />);
    expect(screen.getByTestId("state")).toHaveTextContent("color|color");
  });

  it("is part of KoreProvider, configured through its `theme` prop", () => {
    render(
      <KoreProvider theme={{ defaultTheme: "light" }}>
        <Probe />
      </KoreProvider>,
    );
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});

describe("themeInitScript", () => {
  function run(script: string) {
    document.documentElement.removeAttribute("data-theme");
    new Function(script)();
    return document.documentElement.getAttribute("data-theme");
  }

  it("applies the stored theme before React runs", () => {
    localStorage.setItem("kore-theme", "light");
    expect(run(themeInitScript())).toBe("light");
    localStorage.setItem("kore-theme", "dark");
    expect(run(themeInitScript())).toBe("dark");
  });

  it("falls back to the default for nothing, junk, or a storage error", () => {
    expect(run(themeInitScript())).toBe("color");
    localStorage.setItem("kore-theme", "neon");
    expect(run(themeInitScript())).toBe("color");
    expect(run(themeInitScript({ defaultTheme: "light" }))).toBe("light");
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(run(themeInitScript({ defaultTheme: "dark" }))).toBe("dark");
    spy.mockRestore();
  });

  it("resolves System from the OS, honouring systemDarkTheme", () => {
    localStorage.setItem("kore-theme", "system");
    mockMatchMedia(true);
    expect(run(themeInitScript())).toBe("light");
    mockMatchMedia(false);
    expect(run(themeInitScript())).toBe("color");
    expect(run(themeInitScript({ systemDarkTheme: "dark" }))).toBe("dark");
  });

  it("uses the same key as the provider, and a custom one when asked", () => {
    localStorage.setItem("my-theme", "light");
    expect(run(themeInitScript({ storageKey: "my-theme" }))).toBe("light");
    expect(run(themeInitScript())).toBe("color");
  });
});

describe("ThemeSwitcher", () => {
  it("is a radio group of the three themes and System, and applies a pick at once", async () => {
    render(
      <ThemeProvider>
        <ThemeSwitcher />
      </ThemeProvider>,
    );
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.textContent?.match(/^(Color|Light|Dark|System)/)?.[1])).toEqual(["Color", "Light", "Dark", "System"]);
    expect(screen.getByRole("radio", { name: /^Color/ })).toBeChecked();

    await userEvent.click(screen.getByRole("radio", { name: /^Dark/ }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("radio", { name: /^Dark/ })).toBeChecked();
    expect(localStorage.getItem("kore-theme")).toBe("dark");
  });

  it("moves with the arrow keys", async () => {
    render(
      <ThemeProvider>
        <ThemeSwitcher includeSystem={false} />
      </ThemeProvider>,
    );
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    screen.getByRole("radio", { name: /^Color/ }).focus();
    // Radix selects on arrow-key focus while the key is held; userEvent would release it before the focus lands.
    await userEvent.keyboard("{ArrowRight>}");
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "light"));
    await userEvent.keyboard("{/ArrowRight}");
  });

  it("takes translated labels", () => {
    render(
      <ThemeProvider>
        <ThemeSwitcher aria-label="Оформление" labels={{ light: { name: "Светлая" }, color: { name: "Цветная", description: "Исходная" } }} />
      </ThemeProvider>,
    );
    expect(screen.getByRole("radiogroup", { name: "Оформление" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Светлая/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Цветная/ })).toHaveTextContent("Исходная");
  });
});

