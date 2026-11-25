import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Combobox, defaultComboboxFilter, type ComboboxOption } from "./Combobox";
import { Field } from "./Field";

const ZONES: ComboboxOption[] = [
  { value: "Asia/Almaty", label: "Almaty", description: "UTC+05:00", keywords: ["Kazakhstan"] },
  { value: "Europe/Berlin", label: "Berlin", description: "UTC+01:00", keywords: ["Germany"] },
  { value: "Asia/Tokyo", label: "Tokyo", description: "UTC+09:00", keywords: ["Japan"] },
  { value: "Europe/Zurich", label: "Zürich", description: "UTC+01:00", disabled: true },
];

describe("Combobox", () => {
  it("filters by typing (keywords too), moves with arrows, selects with Enter and returns focus", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Field label="Time zone" hint="Used for reminders.">
        <Combobox options={ZONES} onValueChange={onChange} placeholder="Choose a time zone" searchPlaceholder="Search time zones" />
      </Field>,
    );
    const trigger = screen.getByRole("button", { name: "Time zone" });
    expect(trigger).toHaveAccessibleDescription("Used for reminders.");
    expect(trigger).toHaveTextContent("Choose a time zone");
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    const search = await screen.findByRole("combobox", { name: "Search time zones" });
    await waitFor(() => expect(search).toHaveFocus());
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getAllByRole("option")).toHaveLength(4);

    await user.type(search, "europe");
    // "europe" matches nothing in labels/keywords/descriptions → empty state.
    expect(await screen.findByText("No matches")).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "germany");
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual(["BerlinUTC+01:00"]);
    await user.clear(search);
    await user.type(search, "utc");
    // Highlight starts on the first match; ArrowDown moves; the disabled one is skipped.
    expect(search).toHaveAttribute("aria-activedescendant", within(listbox).getAllByRole("option")[0]!.id);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    const active = document.getElementById(search.getAttribute("aria-activedescendant")!);
    expect(active).toHaveTextContent("Tokyo");
    await user.keyboard("{ArrowDown}");
    expect(document.getElementById(search.getAttribute("aria-activedescendant")!)).toHaveTextContent("Almaty");
    await user.keyboard("{ArrowUp}{Enter}");
    expect(onChange).toHaveBeenCalledWith("Asia/Tokyo", ZONES[2]);
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(trigger).toHaveTextContent("Tokyo");
    expect(trigger).toHaveFocus();
  });

  it("closes on Escape without changing the value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Combobox aria-label="Zone" options={ZONES} defaultValue="Asia/Almaty" onValueChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "Zone" });
    await user.click(trigger);
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: /Almaty/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger).toHaveTextContent("Almaty");
    expect(trigger).toHaveFocus();
  });

  it("selects with a click and submits through a hidden input", async () => {
    const user = userEvent.setup();
    const { container } = render(<Combobox aria-label="Zone" name="tz" options={ZONES} />);
    await user.click(screen.getByRole("button", { name: "Zone" }));
    await user.click(await screen.findByRole("option", { name: /Berlin/ }));
    expect(container.querySelector<HTMLInputElement>('input[name="tz"]')!.value).toBe("Europe/Berlin");
  });

  it("loads options asynchronously, shows loading and errors, and keeps the chosen label", async () => {
    const user = userEvent.setup();
    const loadOptions = vi.fn(async (q: string) => {
      if (q === "boom") throw new Error("down");
      return ZONES.filter((o) => defaultComboboxFilter(o, q));
    });
    render(<Combobox aria-label="Zone" loadOptions={loadOptions} debounceMs={10} selectedLabel="Almaty" value="Asia/Almaty" />);
    const trigger = screen.getByRole("button", { name: "Zone" });
    expect(trigger).toHaveTextContent("Almaty");
    await user.click(trigger);
    expect(await screen.findByRole("option", { name: /Tokyo/ })).toBeInTheDocument();
    expect(loadOptions).toHaveBeenCalledWith("", expect.any(AbortSignal));
    const search = screen.getByRole("combobox");
    await user.type(search, "boom");
    expect(await screen.findByText("Couldn't load results. Try again.")).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "japan");
    await waitFor(() => expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["TokyoUTC+09:00"]));
  });
});
