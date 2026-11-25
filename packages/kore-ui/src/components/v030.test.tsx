import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { SettingsLayout } from "../layout/SettingsLayout";
import { Sidebar, SidebarNav } from "../layout/Sidebar";
import { koreDuration, koreEase } from "../lib/motion";
import { Alert, InlineMessage, SaveStatus } from "./Alert";
import { CardList, ListRow } from "./CardList";
import { tintOf } from "./color";
import { Textarea } from "./Input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "./Menu";
import { Stat } from "./Stat";
import { Table, TableBody, TableSkeleton } from "./Table";
import { ToggleButton, ToggleGroup, ToggleGroupItem } from "./Toggle";

describe("Alert", () => {
  it("announces danger at once and everything else politely", () => {
    const { rerender } = render(<Alert tone="danger">Backups failed.</Alert>);
    expect(screen.getByRole("alert")).toHaveTextContent("Backups failed.");
    rerender(<Alert tone="warning">Backups are paused.</Alert>);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Backups are paused.");
    rerender(<Alert>Nothing to do.</Alert>);
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "info");
  });

  it("shows a title above the body, an action, and a named close button", async () => {
    const onDismiss = vi.fn();
    render(
      <Alert tone="warning" title="Backups are paused" action={<button type="button">Resume</button>} onDismiss={onDismiss}>
        Nothing has been saved since Monday.
      </Alert>,
    );
    const box = screen.getByRole("status");
    expect(within(box).getByText("Backups are paused")).toBeInTheDocument();
    expect(within(box).getByText("Nothing has been saved since Monday.")).toBeInTheDocument();
    expect(within(box).getByRole("button", { name: "Resume" })).toBeInTheDocument();
    await userEvent.click(within(box).getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("takes a custom dismiss label, hides the icon on request and can be a banner", () => {
    const { container } = render(
      <Alert banner icon={false} onDismiss={() => {}} dismissLabel="Close notice">
        Update ready.
      </Alert>,
    );
    expect(screen.getByRole("button", { name: "Close notice" })).toBeInTheDocument();
    expect(container.querySelector("svg:not(button svg)")).toBeNull();
    expect(screen.getByRole("status").className).toContain("rounded-none");
  });
});

describe("InlineMessage", () => {
  it("is an alert for danger and a status otherwise", () => {
    const { rerender } = render(<InlineMessage>Couldn't reach the server. Check your connection and try again.</InlineMessage>);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't reach the server.");
    rerender(<InlineMessage tone="success">Saved</InlineMessage>);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });
});

describe("SaveStatus", () => {
  it("says each state in words and keeps its live region while idle", () => {
    const { rerender } = render(<SaveStatus state="idle" />);
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    rerender(<SaveStatus state="saving" />);
    expect(screen.getByRole("status")).toHaveTextContent("Saving…");
    expect(screen.getByRole("status")).toBe(region);
    rerender(<SaveStatus state="saved" />);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    rerender(<SaveStatus state="error" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save. Try again.");
  });

  it("takes translated labels", () => {
    render(<SaveStatus state="saved" labels={{ saved: "Сохранено" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Сохранено");
  });
});

describe("ToggleButton and ToggleGroup", () => {
  it("is a pressed button, controlled or not", async () => {
    const onPressedChange = vi.fn();
    render(<ToggleButton onPressedChange={onPressedChange}>Only mine</ToggleButton>);
    const button = screen.getByRole("button", { name: "Only mine" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(onPressedChange).toHaveBeenLastCalledWith(true);
  });

  it("follows `pressed` when controlled", async () => {
    function Example() {
      const [on, setOn] = useState(true);
      return (
        <ToggleButton pressed={on} onPressedChange={setOn}>
          Down only
        </ToggleButton>
      );
    }
    render(<Example />);
    const button = screen.getByRole("button", { name: "Down only" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("a single group picks one, a multiple group picks any", async () => {
    const onSingle = vi.fn();
    const onMultiple = vi.fn();
    render(
      <>
        <ToggleGroup type="single" aria-label="Range" joined defaultValue="24h" onValueChange={onSingle}>
          <ToggleGroupItem value="1h">1h</ToggleGroupItem>
          <ToggleGroupItem value="24h">24h</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="multiple" aria-label="Weekdays" shape="round" onValueChange={onMultiple}>
          <ToggleGroupItem value="mo" aria-label="Monday">
            M
          </ToggleGroupItem>
          <ToggleGroupItem value="tu" aria-label="Tuesday">
            T
          </ToggleGroupItem>
        </ToggleGroup>
      </>,
    );
    expect(screen.getByRole("radio", { name: "24h" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "1h" }));
    expect(onSingle).toHaveBeenLastCalledWith("1h");
    expect(screen.getByRole("radio", { name: "24h" })).not.toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: "Monday" }));
    await userEvent.click(screen.getByRole("button", { name: "Tuesday" }));
    expect(onMultiple).toHaveBeenLastCalledWith(["mo", "tu"]);
    expect(screen.getByRole("button", { name: "Monday" }).className).toContain("rounded-full");
  });
});

describe("Stat", () => {
  it("reads as label, figure, hint", () => {
    render(<Stat label="Active users" value="12" hint="of 20 seats" tone="warning" />);
    expect(screen.getByRole("term")).toHaveTextContent("Active users");
    const [figure, hint] = screen.getAllByRole("definition");
    expect(figure).toHaveTextContent("12");
    expect(figure?.className).toContain("text-warning");
    expect(hint).toHaveTextContent("of 20 seats");
  });

  it("swaps the figure for a placeholder while loading", () => {
    const { container } = render(<Stat label="Uptime" value="99.9%" loading />);
    expect(screen.queryByText("99.9%")).toBeNull();
    expect(container.querySelector("dl")).toHaveAttribute("aria-busy", "true");
  });
});

describe("CardList and ListRow", () => {
  it("renders plain, link and button rows with value and actions outside the link", async () => {
    const onClick = vi.fn();
    const onRevoke = vi.fn();
    render(
      <CardList aria-label="Sessions">
        <ListRow label="Email" value="anna@example.com" />
        <ListRow label="Security" description="Password, devices" href="/security" />
        <ListRow label="Chrome on macOS" description="Almaty" onClick={onClick} actions={<button type="button" onClick={onRevoke}>Sign out</button>} />
      </CardList>,
    );
    const list = screen.getByRole("list", { name: "Sessions" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("anna@example.com")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Security/ });
    expect(link).toHaveAttribute("href", "/security");
    expect(link).toHaveTextContent("Password, devices");

    await userEvent.click(screen.getByRole("button", { name: /Chrome on macOS/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
    const signOut = screen.getByRole("button", { name: "Sign out" });
    expect(signOut.closest("button, a")).toBe(signOut);
    await userEvent.click(signOut);
    expect(onRevoke).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("TableSkeleton", () => {
  it("renders placeholder rows with one loading status", () => {
    const { container } = render(
      <Table caption="Users">
        <TableBody>
          <TableSkeleton columns={["w-40", "w-24", "w-16"]} rows={3} />
        </TableBody>
      </Table>,
    );
    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(container.querySelectorAll("tbody tr:first-child td")).toHaveLength(3);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(container.querySelectorAll("[aria-hidden='true']").length).toBe(9);
  });

  it("takes a column count and a translated label", () => {
    const { container } = render(
      <table>
        <tbody>
          <TableSkeleton columns={2} label="Загрузка…" />
        </tbody>
      </table>,
    );
    expect(container.querySelectorAll("tr")).toHaveLength(4);
    expect(screen.getByRole("status")).toHaveTextContent("Загрузка…");
  });
});

describe("MenuItem asChild", () => {
  it("keeps the icon and shortcut around a link's own text", async () => {
    render(
      <Menu>
        <MenuTrigger>Account</MenuTrigger>
        <MenuContent>
          <MenuItem asChild icon={<svg data-testid="gear" />} shortcut="⌘,">
            <a href="/settings">Settings</a>
          </MenuItem>
          <MenuItem asChild>
            <a href="/plain">Plain</a>
          </MenuItem>
        </MenuContent>
      </Menu>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    const link = screen.getByRole("menuitem", { name: /Settings/ });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/settings");
    expect(within(link).getByTestId("gear")).toBeInTheDocument();
    expect(link).toHaveTextContent("Settings");
    expect(link).toHaveTextContent("⌘,");
    const plain = screen.getByRole("menuitem", { name: "Plain" });
    expect(plain.querySelector("svg")).toBeNull();
  });
});

describe("Textarea autoGrow", () => {
  function mockScrollHeight(el: HTMLElement, height: number) {
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: height });
  }

  it("grows with its content up to maxHeight, then scrolls", () => {
    render(<Textarea autoGrow maxHeight={120} aria-label="Message" />);
    const area = screen.getByRole("textbox", { name: "Message" });
    mockScrollHeight(area, 80);
    fireEvent.input(area, { target: { value: "a\nb\nc" } });
    expect(area.style.height).toBe("80px");
    expect(area.style.overflowY).toBe("hidden");
    mockScrollHeight(area, 300);
    fireEvent.input(area, { target: { value: "a\nb\nc\nd\ne\nf\ng\nh" } });
    expect(area.style.height).toBe("120px");
    expect(area.style.overflowY).toBe("auto");
    expect(area.className).toContain("resize-none");
  });

  it("stays a plain resizable textarea without autoGrow and still calls onInput", () => {
    const onInput = vi.fn();
    render(<Textarea aria-label="Notes" onInput={onInput} />);
    const area = screen.getByRole("textbox", { name: "Notes" });
    fireEvent.input(area, { target: { value: "x" } });
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(area.style.height).toBe("");
    expect(area.className).toContain("resize-y");
  });
});

describe("SettingsLayout current pill", () => {
  it("scrolls the current section into view when the nav overflows", () => {
    const scrollTo = vi.fn();
    const proto = HTMLElement.prototype as unknown as { scrollTo?: unknown };
    const original = proto.scrollTo;
    proto.scrollTo = scrollTo;
    const widths = { clientWidth: 200, scrollWidth: 600 } as const;
    const spies = (Object.keys(widths) as (keyof typeof widths)[]).map((key) =>
      vi.spyOn(HTMLElement.prototype, key, "get").mockReturnValue(widths[key]),
    );
    const items = ["a", "b", "c"].map((id) => ({ id, label: id.toUpperCase(), onSelect: () => {} }));
    const { rerender } = render(
      <SettingsLayout items={items} current="a">
        content
      </SettingsLayout>,
    );
    scrollTo.mockClear();
    rerender(
      <SettingsLayout items={items} current="c">
        content
      </SettingsLayout>,
    );
    expect(scrollTo).toHaveBeenCalledTimes(1);
    spies.forEach((spy) => spy.mockRestore());
    proto.scrollTo = original;
  });
});

describe("SidebarNav empty", () => {
  it("shows the empty line only when there are no items", () => {
    const { rerender } = render(
      <Sidebar>
        <SidebarNav label="Chats" empty="No chats yet" />
      </Sidebar>,
    );
    expect(screen.getByText("No chats yet")).toBeInTheDocument();
    rerender(
      <Sidebar>
        <SidebarNav label="Chats" empty="No chats yet">
          <li>First chat</li>
        </SidebarNav>
      </Sidebar>,
    );
    expect(screen.queryByText("No chats yet")).toBeNull();
    expect(screen.getByText("First chat")).toBeInTheDocument();
  });
});

describe("tintOf", () => {
  it("mixes the colour into the surface and returns the solid colour", () => {
    const t = tintOf("#5B8DEF");
    expect(t.edge).toBe("#5b8def");
    expect(t.background).toBe("color-mix(in srgb, #5b8def 24%, var(--color-surface))");
    expect(t.text).toBe("color-mix(in srgb, #5b8def 60%, var(--color-text))");
    expect(tintOf("#abc", 0.5).background).toContain("#aabbcc 50%");
  });

  it("falls back to the accent for anything that is not a hex colour", () => {
    expect(tintOf("rebeccapurple").edge).toBe("var(--color-accent)");
    expect(tintOf("").background).toContain("var(--color-accent) 24%");
  });
});

/* ---- Drift guards: JS copies of the theme must equal theme.css. ---- */

const themeCss = readFileSync("theme.css", "utf8") /* vitest runs from the repo root */;

function token(name: string): string {
  const match = themeCss.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match?.[1]) throw new Error(`--${name} is not in theme.css`);
  return match[1].trim();
}

describe("theme.css and its JS mirrors", () => {
  it("koreEase and koreDuration match the animations", () => {
    expect(koreEase.css.standard).toBe(token("ease-standard"));
    expect(koreEase.css.exit).toBe(token("ease-exit"));
    expect(`cubic-bezier(${koreEase.standard.join(", ")})`).toBe(koreEase.css.standard);
    expect(`cubic-bezier(${koreEase.exit.join(", ")})`).toBe(koreEase.css.exit);
    const ms = (animation: string) => Number(token(`animate-kore-${animation}`).match(/(\d+)ms/)?.[1]) / 1000;
    expect(koreDuration.pop).toEqual({ in: ms("pop-in"), out: ms("pop-out") });
    expect(koreDuration.dialog).toEqual({ in: ms("dialog-in"), out: ms("dialog-out") });
    expect(koreDuration.drawer).toEqual({ in: ms("drawer-in"), out: ms("drawer-out") });
    expect(koreDuration.toast).toEqual({ in: ms("toast-in"), out: ms("toast-out") });
    expect(koreDuration.fade).toEqual({ in: ms("fade-in"), out: ms("fade-out") });
    expect(koreDuration.view).toBe(koreDuration.sidebar);
  });

  it("defines the overlay, on-accent, chart and z-index tokens the components use", () => {
    for (const name of ["color-hover", "color-hover-subtle", "color-active", "color-track", "color-on-accent", "color-status-critical"]) {
      expect(token(name), name).toBeTruthy();
    }
    for (const n of [1, 2, 3, 4]) expect(token(`color-chart-${n}`)).toMatch(/^#[0-9a-f]{6}$/);
    expect(["sticky", "drawer", "overlay", "toast", "tooltip"].map((z) => Number(token(`z-${z}`)))).toEqual([10, 40, 50, 60, 70]);
  });
});
