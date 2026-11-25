import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "../layout/AppShell";
import { Sidebar, SidebarItem, SidebarNav } from "../layout/Sidebar";
import { TopBar } from "../layout/TopBar";
import { AppTile } from "../identity/AppTile";
import { InlineMessage } from "./Alert";
import { Badge } from "./Badge";
import { CardList, ListRow } from "./CardList";
import { Checkbox } from "./Checkbox";
import { CodeBlock } from "./CodeBlock";
import { ColorDot } from "./ColorDot";
import { CopyField } from "./CopyField";
import { DescriptionList } from "./DescriptionList";
import { FilterBar } from "./FilterBar";
import { LoadingState } from "./LoadingState";
import { Meter, meterTone } from "./Meter";
import { PointTooltip } from "./PointTooltip";
import { SearchButton } from "./SearchButton";
import { SelectionBar } from "./SelectionBar";
import { Skeleton } from "./Skeleton";
import { Stat } from "./Stat";
import { Time, formatRelativeTime } from "./Time";

describe("formatRelativeTime", () => {
  const now = new Date(2026, 10, 16, 15, 30, 0); // Nov 16 2026, 15:30 local
  const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0) => new Date(y, m, d, h, min, s);
  const fmt = (v: Parameters<typeof formatRelativeTime>[0], o = {}) => formatRelativeTime(v, { now, locale: "en-US", ...o });

  it("says Just now for the last minute", () => {
    expect(fmt(at(2026, 10, 16, 15, 29, 30))).toBe("Just now");
    expect(fmt(at(2026, 10, 16, 15, 29, 30), { inline: true })).toBe("just now");
  });

  it("says Today and Yesterday with the time, on a 24-hour clock by default", () => {
    expect(fmt(at(2026, 10, 16, 7, 43))).toBe("Today 07:43");
    expect(fmt(at(2026, 10, 16, 0, 5))).toBe("Today 00:05");
    expect(fmt(at(2026, 10, 15, 21, 5))).toBe("Yesterday 21:05");
    expect(fmt(at(2026, 10, 16, 19, 5), { hour12: true })).toMatch(/^Today 0?7:05\s?PM$/);
  });

  it("uses dates beyond that, adding the year only for another year", () => {
    expect(fmt(at(2026, 0, 3, 9, 0))).toBe("Jan 3");
    expect(fmt(at(2025, 0, 3, 9, 0))).toBe("Jan 3, 2025");
  });

  it("lower-cases the leading word inline, and takes ISO strings and timestamps", () => {
    expect(fmt(at(2026, 10, 16, 7, 43), { inline: true })).toBe("today 07:43");
    expect(fmt(at(2026, 10, 15, 21, 5), { inline: true })).toBe("yesterday 21:05");
    expect(fmt(at(2026, 10, 16, 7, 43).toISOString())).toBe("Today 07:43");
    expect(fmt(at(2026, 10, 16, 7, 43).getTime())).toBe("Today 07:43");
  });

  it("handles a missing or unparseable moment, with translatable words", () => {
    expect(fmt(null)).toBe("Never");
    expect(fmt(undefined, { inline: true })).toBe("never");
    expect(fmt("not a date")).toBe("—");
    expect(fmt(null, { labels: { never: "Никогда" } })).toBe("Никогда");
    expect(fmt(at(2026, 10, 16, 15, 29, 40), { labels: { justNow: "Только что" } })).toBe("Только что");
  });

  it("follows the locale for the words", () => {
    expect(formatRelativeTime(at(2026, 10, 16, 7, 43), { now, locale: "ru" })).toMatch(/^Сегодня 07:43$/);
    expect(formatRelativeTime(at(2026, 10, 15, 7, 43), { now, locale: "ru" })).toMatch(/^Вчера 07:43$/);
  });

  it("<Time> is a time element with the exact moment as title and dateTime", () => {
    const moment = at(2026, 10, 16, 7, 43);
    render(<Time value={moment} now={now} locale="en-US" className="x" />);
    const el = screen.getByText("Today 07:43");
    expect(el.tagName).toBe("TIME");
    expect(el).toHaveAttribute("datetime", moment.toISOString());
    expect(el).toHaveAttribute("title", moment.toLocaleString("en-US"));
    expect(el).toHaveClass("x");
  });

  it("<Time> renders plain text for a missing value", () => {
    const { container } = render(<Time value={null} />);
    expect(container.querySelector("time")).toBeNull();
    expect(container).toHaveTextContent("Never");
  });
});

describe("CopyField", () => {
  it("shows a read-only value, selects it on focus and copies it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<CopyField aria-label="Setup link" value="https://id.example.com/setup/abc" />);
    const input = screen.getByLabelText("Setup link") as HTMLInputElement;
    expect(input).toHaveAttribute("readonly");
    expect(input.value).toBe("https://id.example.com/setup/abc");
    const select = vi.spyOn(input, "select");
    fireEvent.focus(input);
    expect(select).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("https://id.example.com/setup/abc");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copied"));
  });

  it("takes translated copy labels and a monospace look", () => {
    render(<CopyField aria-label="Token" value="abc" mono copy={{ label: "Копировать" }} />);
    expect(screen.getByRole("button", { name: "Копировать" })).toBeInTheDocument();
    // With a trailing button the class lands on the wrapper; the input inherits the font from it.
    expect(screen.getByLabelText("Token").parentElement?.className).toContain("font-mono");
  });
});

describe("DescriptionList", () => {
  it("is a dl of terms and values, several values per term allowed", () => {
    const { container } = render(
      <DescriptionList
        items={[
          { label: "Issuer", value: "https://id.example.com", mono: true },
          { label: "Redirect URIs", value: ["https://a.example/cb", "https://b.example/cb"] },
        ]}
      />,
    );
    expect(container.querySelector("dl")).toBeInTheDocument();
    expect(screen.getAllByRole("term").map((t) => t.textContent)).toEqual(["Issuer", "Redirect URIs"]);
    expect(screen.getAllByRole("definition")).toHaveLength(3);
    expect(screen.getByText("https://id.example.com").className).toContain("font-mono");
  });
});

describe("CodeBlock", () => {
  it("shows the code as is with a language name and a Copy button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<CodeBlock language="bash" value={"npm install\nnpm test"} />);
    expect(screen.getByText("bash")).toBeInTheDocument();
    expect(screen.getByText(/npm install/).closest("pre")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("npm install\nnpm test");
  });

  it("scrolls sideways unless asked to wrap", () => {
    const { rerender, container } = render(<CodeBlock value="x" />);
    expect(container.querySelector("pre")?.className).not.toContain("whitespace-pre-wrap");
    rerender(<CodeBlock value="x" wrap />);
    expect(container.querySelector("pre")?.className).toContain("whitespace-pre-wrap");
  });
});

describe("LoadingState, FilterBar, ColorDot, SearchButton", () => {
  it("LoadingState says what is loading in words", () => {
    render(<LoadingState label="Loading users…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading users…");
  });

  it("FilterBar is a named group", () => {
    render(
      <FilterBar label="Filter users">
        <input aria-label="Search" />
      </FilterBar>,
    );
    expect(within(screen.getByRole("group", { name: "Filter users" })).getByLabelText("Search")).toBeInTheDocument();
  });

  it("ColorDot is decorative, round or square, and carries the colour", () => {
    const { container, rerender } = render(<ColorDot color="#4fb286" />);
    const dot = container.firstElementChild as HTMLElement;
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(dot.style.backgroundColor).toBe("rgb(79, 178, 134)");
    expect(dot.className).toContain("rounded-full");
    rerender(<ColorDot color="#4fb286" shape="square" size="sm" />);
    expect((container.firstElementChild as HTMLElement).className).toContain("rounded-[3px]");
  });

  it("SearchButton is a button that looks like a search box, with the shortcut shown", async () => {
    const onClick = vi.fn();
    render(<SearchButton label="Search monitors" onClick={onClick} />);
    const button = screen.getByRole("button", { name: /Search monitors/ });
    expect(button).toHaveTextContent("⌘K");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("SearchButton can hide the hint", () => {
    render(<SearchButton hint={null} />);
    expect(screen.getByRole("button")).not.toHaveTextContent("⌘K");
  });
});

describe("SelectionBar", () => {
  it("renders nothing at zero and a toolbar otherwise", async () => {
    const onClear = vi.fn();
    const { rerender } = render(<SelectionBar count={0} actions={<button type="button">Delete</button>} onClear={onClear} />);
    expect(screen.queryByRole("toolbar")).toBeNull();
    rerender(<SelectionBar count={3} actions={<button type="button">Delete</button>} onClear={onClear} />);
    const bar = screen.getByRole("toolbar", { name: "Selection actions" });
    expect(bar).toHaveTextContent("3 selected");
    expect(within(bar).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole("button", { name: "Clear selection" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("takes a custom summary and labels", () => {
    render(<SelectionBar count={2} summary="Выбрано: 2" labels={{ toolbar: "Действия", clear: "Снять выбор" }} actions={null} onClear={() => {}} />);
    expect(screen.getByRole("toolbar", { name: "Действия" })).toHaveTextContent("Выбрано: 2");
    expect(screen.getByRole("button", { name: "Снять выбор" })).toBeInTheDocument();
  });
});

describe("PointTooltip", () => {
  it("renders nothing without a point and a tooltip near it with one", () => {
    const { rerender } = render(<PointTooltip point={null}>Up, 120 ms</PointTooltip>);
    expect(screen.queryByRole("tooltip")).toBeNull();
    rerender(
      <PointTooltip point={{ x: 100, y: 80 }} id="beat">
        Up, 120 ms
      </PointTooltip>,
    );
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Up, 120 ms");
    expect(tip).toHaveAttribute("id", "beat");
    expect(tip.className).toContain("pointer-events-none");
  });

  it("flips to the other side of the point near the viewport edge", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 400 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 300 });
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 120, height: 30, x: 0, y: 0, top: 0, left: 0, right: 120, bottom: 30, toJSON() {} } as DOMRect);
    render(<PointTooltip point={{ x: 380, y: 290 }}>Edge</PointTooltip>);
    const tip = screen.getByRole("tooltip");
    expect(parseFloat(tip.style.left)).toBe(380 - 12 - 120);
    expect(parseFloat(tip.style.top)).toBe(290 - 12 - 30);
    rect.mockRestore();
  });
});

describe("AppTile", () => {
  it("draws the mark of a Kore product", () => {
    const { container } = render(<AppTile app="flatline" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("shows initials for an app Kore does not know", () => {
    const { container, rerender } = render(<AppTile app="acme-cloud" name="Acme Cloud" />);
    expect(container).toHaveTextContent("AC");
    rerender(<AppTile app="my-app" />);
    expect(container).toHaveTextContent("MA");
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("closed gaps in existing components", () => {
  it("InlineMessage opens smoothly when animated", async () => {
    const { container } = render(<InlineMessage animated>Couldn't save.</InlineMessage>);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save.");
    const wrapper = container.firstElementChild as HTMLElement;
    await waitFor(() => expect(wrapper).toHaveAttribute("data-open", "true"));
    expect(wrapper.className).toContain("grid-rows-[1fr]");
  });

  it("InlineMessage stays a plain paragraph when not animated", () => {
    const { container } = render(<InlineMessage className="mt-2">Plain</InlineMessage>);
    expect(container.firstElementChild?.tagName).toBe("P");
    expect(container.firstElementChild).toHaveClass("mt-2");
  });

  it("Stat has an accent tone", () => {
    render(<Stat label="Info" value="7" tone="accent" />);
    expect(screen.getAllByRole("definition")[0]?.className).toContain("text-accent-fg");
  });

  it("ListRow takes its own content and can wrap", () => {
    render(
      <CardList>
        <ListRow icon={<svg data-testid="i" />} actions={<button type="button">Edit</button>}>
          <input aria-label="Memory" defaultValue="Likes tea" />
        </ListRow>
        <ListRow label="A very long label that should wrap" description="And a long description" wrap />
        <ListRow label="Plain label" />
      </CardList>,
    );
    expect(screen.getByLabelText("Memory")).toHaveValue("Likes tea");
    expect(screen.getByTestId("i")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByText("A very long label that should wrap").className).toContain("break-words");
    expect(screen.getByText("Plain label").className).toContain("truncate");
  });

  it("Meter has a critical tone above its own threshold and a smaller bar", () => {
    expect(meterTone(0.95)).toBe("danger");
    expect(meterTone(0.95, { critical: 0.95 })).toBe("critical");
    expect(meterTone(0.94, { critical: 0.95 })).toBe("danger");
    render(<Meter label="CPU" value={97} thresholds={{ critical: 0.95 }} valueText="97% busy" size="sm" />);
    const meter = screen.getByRole("meter", { name: "CPU" });
    expect(meter).toHaveAttribute("data-tone", "critical");
    expect(meter.className).toContain("h-1");
    expect(meter.className).not.toContain("h-1.5");
    expect(meter.firstElementChild?.className).toContain("bg-status-critical");
    expect(screen.getByText("97% busy").className).toContain("text-danger");
  });

  it("Checkbox can truncate its label", () => {
    render(<Checkbox label="A calendar with a very long name" truncate />);
    expect(screen.getByText("A calendar with a very long name").className).toContain("truncate");
  });

  it("Badge has a roomier size", () => {
    render(<Badge size="md">Free</Badge>);
    expect(screen.getByText("Free").className).toContain("text-meta");
  });

  it("Skeleton can be still", () => {
    const { container, rerender } = render(<Skeleton />);
    expect(container.firstElementChild).toHaveClass("animate-pulse");
    rerender(<Skeleton pulse={false} />);
    expect(container.firstElementChild).not.toHaveClass("animate-pulse");
  });
});

describe("SidebarNav and AppShell collapse shortcut", () => {
  function Shell({ shortcut, onChange }: { shortcut?: string | false; onChange: (collapsed: boolean) => void }) {
    return (
      <AppShell
        collapsible
        collapseShortcut={shortcut}
        onSidebarCollapsedChange={onChange}
        topBar={<TopBar />}
        sidebar={
          <Sidebar>
            <SidebarNav label="Sections">
              <SidebarItem href="/a">A</SidebarItem>
            </SidebarNav>
          </Sidebar>
        }
      >
        <input aria-label="Field" />
      </AppShell>
    );
  }

  it("toggles with Ctrl+B or ⌘B when enabled, through the same callback", () => {
    const onChange = vi.fn();
    render(<Shell shortcut="b" onChange={onChange} />);
    fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(document.body, { key: "B", metaKey: true });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("is off by default, ignores other keys and modifiers, and stays out of text fields", () => {
    const onChange = vi.fn();
    const { unmount } = render(<Shell onChange={onChange} />);
    fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
    expect(onChange).not.toHaveBeenCalled();
    unmount();

    render(<Shell shortcut="b" onChange={onChange} />);
    fireEvent.keyDown(document.body, { key: "b" });
    fireEvent.keyDown(document.body, { key: "b", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    fireEvent.keyDown(screen.getByLabelText("Field"), { key: "b", ctrlKey: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("SidebarNav shows its empty line only without items", () => {
    const { rerender } = render(<SidebarNav label="Chats" empty="No chats yet" />);
    expect(screen.getByText("No chats yet")).toBeInTheDocument();
    rerender(
      <SidebarNav label="Chats" empty="No chats yet">
        <li>One</li>
      </SidebarNav>,
    );
    expect(screen.queryByText("No chats yet")).toBeNull();
  });
});
