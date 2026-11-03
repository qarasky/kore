import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AccountMenu } from "../identity/AccountMenu";
import { AuthScreen } from "../identity/AuthScreen";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { ColorSwatchPicker } from "./ColorSwatchPicker";
import { CommandGroup, CommandItem, CommandPalette } from "./CommandPalette";
import { Dialog, DialogBody, DialogContent, DialogTrigger } from "./Dialog";
import { Field } from "./Field";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  MenuItem,
  MenuSeparator,
  PointMenu,
  pointFromEvent,
  type MenuPoint,
  type PointMenuCloseReason,
} from "./Menu";
import { PasswordInput, minLengthRule } from "./PasswordInput";
import { Sheet, SheetBody, SheetContent, SheetTrigger } from "./Sheet";
import { StatusDot } from "./StatusDot";
import { ToastProvider, useToast } from "./Toast";

describe("ContextMenu", () => {
  function Example({ onRename = vi.fn(), onDelete = vi.fn(), onMove = vi.fn() }) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>
            <button type="button">notes.md</button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onRename} shortcut="F2">
            Rename
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Move to</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem onSelect={onMove}>Archive</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem danger onSelect={onDelete}>
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  it("opens on right-click", async () => {
    render(<Example />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "notes.md" }), { clientX: 40, clientY: 40 });
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveAttribute("data-danger");
  });

  it.each([
    ["Shift+F10", "{Shift>}{F10}{/Shift}"],
    ["the Menu key", "{ContextMenu}"],
  ])("opens from the keyboard with %s, and submenus open with ArrowRight", async (_, keys) => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<Example onMove={onMove} />);
    screen.getByRole("button", { name: "notes.md" }).focus();
    await user.keyboard(keys);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Rename/ })).toBeInTheDocument();
    // Opened from the keyboard, the first item has focus.
    await waitFor(() => expect(within(menu).getByRole("menuitem", { name: /Rename/ })).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Move to" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    const archive = await screen.findByRole("menuitem", { name: "Archive" });
    await waitFor(() => expect(archive).toHaveFocus());
    await user.keyboard("{Enter}");
    expect(onMove).toHaveBeenCalledOnce();
  });
});

describe("PointMenu", () => {
  function Canvas({ onClose }: { onClose: (r: PointMenuCloseReason) => void }) {
    const [point, setPoint] = useState<MenuPoint | null>(null);
    return (
      <>
        <div
          data-testid="canvas"
          tabIndex={0}
          onContextMenu={(e) => {
            e.preventDefault();
            setPoint(pointFromEvent(e));
          }}
        />
        <PointMenu
          point={point}
          label="Actions for edge-02"
          onClose={(r) => {
            onClose(r);
            setPoint(null);
          }}
        >
          <MenuItem>Open</MenuItem>
          <MenuSeparator />
          <MenuItem danger>Delete</MenuItem>
        </PointMenu>
      </>
    );
  }

  it("opens at the point, then reports why it closed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Canvas onClose={onClose} />);
    fireEvent.contextMenu(screen.getByTestId("canvas"), { clientX: 120, clientY: 80 });
    const menu = await screen.findByRole("menu", { name: "Actions for edge-02" });
    // Like a native right-click menu, the panel has focus; ArrowDown reaches the first item.
    await waitFor(() => expect(menu).toContainElement(document.activeElement as HTMLElement));
    await user.keyboard("{ArrowDown}");
    expect(within(menu).getByRole("menuitem", { name: "Open" })).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onClose).toHaveBeenCalledWith("escape"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByTestId("canvas"), { clientX: 10, clientY: 10 });
    await user.click(await screen.findByRole("menuitem", { name: "Open" }));
    await waitFor(() => expect(onClose).toHaveBeenLastCalledWith("select"));
  });

  it("pointFromEvent uses the cursor, or the target's position for keyboard events", () => {
    expect(pointFromEvent({ clientX: 5, clientY: 6 })).toEqual({ x: 5, y: 6 });
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ left: 100, top: 50, width: 200, height: 40 }) as DOMRect;
    expect(pointFromEvent({ clientX: 0, clientY: 0, target: el })).toEqual({ x: 116, y: 82 });
  });
});

describe("CommandPalette", () => {
  function Example({ onFiles = vi.fn(), onTrash = vi.fn() }) {
    return (
      <CommandPalette
        groups={[
          {
            heading: "Go to",
            commands: [
              { id: "files", label: "My files", keywords: ["drive"], shortcut: "G F", onSelect: onFiles },
              { id: "trash", label: "Trash", onSelect: onTrash },
            ],
          },
        ]}
      >
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => {}}>Upload files</CommandItem>
        </CommandGroup>
      </CommandPalette>
    );
  }

  it("opens on Ctrl+K, filters (keywords too), runs the chosen command and closes", async () => {
    const user = userEvent.setup();
    const onFiles = vi.fn();
    render(<Example onFiles={onFiles} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    const input = within(dialog).getByRole("combobox");
    await waitFor(() => expect(input).toHaveFocus());
    expect(within(dialog).getAllByRole("option")).toHaveLength(3);
    expect(within(dialog).getByText("Go to")).toBeInTheDocument();
    await user.type(input, "drive");
    await waitFor(() => expect(within(dialog).getAllByRole("option")).toHaveLength(1));
    await user.keyboard("{Enter}");
    expect(onFiles).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("moves with arrows, shows an empty state, and closes on Escape", async () => {
    const user = userEvent.setup();
    const onTrash = vi.fn();
    render(<Example onTrash={onTrash} />);
    await user.keyboard("{Meta>}k{/Meta}");
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByRole("combobox");
    await user.type(input, "zzz");
    expect(await within(dialog).findByText("No results")).toBeInTheDocument();
    await user.clear(input);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onTrash).toHaveBeenCalledOnce();
    await user.keyboard("{Control>}k{/Control}");
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("doesn't open over another dialog", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Dialog defaultOpen>
          <DialogContent title="Rename">
            <DialogBody>body</DialogBody>
          </DialogContent>
        </Dialog>
        <Example />
      </>,
    );
    await screen.findByRole("dialog", { name: "Rename" });
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
  });
});

describe("Sheet", () => {
  it("opens from its trigger as a named dialog, traps focus, closes on Escape and returns focus", async () => {
    const user = userEvent.setup();
    render(
      <Sheet>
        <SheetTrigger asChild>
          <Button>Peek</Button>
        </SheetTrigger>
        <SheetContent title="Monitor details" side="left" size="lg">
          <SheetBody>
            <button type="button">Edit</button>
          </SheetBody>
        </SheetContent>
      </Sheet>,
    );
    const trigger = screen.getByRole("button", { name: "Peek" });
    await user.click(trigger);
    const sheet = await screen.findByRole("dialog", { name: "Monitor details" });
    expect(sheet).toHaveAttribute("data-side", "left");
    expect(sheet).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

describe("PasswordInput", () => {
  it("toggles visibility with a named, pressed button and uses current-password by default", async () => {
    const user = userEvent.setup();
    render(
      <Field label="Password">
        <PasswordInput />
      </Field>,
    );
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "current-password");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  });

  it("new-password mode: autocomplete, live rule checklist, described by hint + rules", async () => {
    const user = userEvent.setup();
    render(
      <Field label="New password" hint="Use a passphrase.">
        <PasswordInput newPassword rules={[minLengthRule(10), { label: "A number", test: (p) => /\d/.test(p) }]} />
      </Field>,
    );
    const input = screen.getByLabelText("New password");
    expect(input).toHaveAttribute("autocomplete", "new-password");
    expect(input.getAttribute("aria-describedby")!.split(" ")).toHaveLength(2);
    expect(input).toHaveAccessibleDescription(/Use a passphrase\..*At least 10 characters: not yet.*A number: not yet/);
    await user.type(input, "correct horse 1");
    expect(screen.getByText("At least 10 characters").closest("li")).toHaveAttribute("data-met");
    expect(screen.getByText("A number").closest("li")).toHaveAttribute("data-met");
  });
});

describe("AuthScreen set-password mode", () => {
  it("uses new-password autocomplete, set-password labels and shows the rules", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <AuthScreen
        mode="set-password"
        password={{ onSubmit, defaultEmail: "sky@qarasky.dev", emailReadOnly: true, rules: [minLengthRule(10)] }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Set your password" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("readonly");
    const pw = screen.getByLabelText("New password");
    expect(pw).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByText("At least 10 characters")).toBeInTheDocument();
    await user.type(pw, "a long new password");
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(onSubmit).toHaveBeenCalledWith({ email: "sky@qarasky.dev", password: "a long new password" });
  });

  it("sign-in mode keeps current-password", () => {
    render(<AuthScreen password={{ onSubmit: () => {} }} />);
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });
});

describe("ColorSwatchPicker", () => {
  const COLORS = [
    { value: "#5b8def", label: "Blue" },
    { value: "#3fb950", label: "Green" },
    { value: "#e5a54b", label: "Amber" },
  ];

  it("is a radio group: arrow keys move and select, the selected one is checked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Field label="Colour">
        <ColorSwatchPicker colors={COLORS} defaultValue="#5B8DEF" onValueChange={onChange} />
      </Field>,
    );
    const group = screen.getByRole("radiogroup", { name: "Colour" });
    const blue = within(group).getByRole("radio", { name: "Blue" });
    expect(blue).toHaveAttribute("aria-checked", "true");
    blue.focus();
    // Hold the key: Radix selects on the focus that follows an arrow key press.
    await user.keyboard("{ArrowRight>}");
    await waitFor(() => expect(within(group).getByRole("radio", { name: "Green" })).toHaveAttribute("aria-checked", "true"));
    await user.keyboard("{/ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("#3fb950");
  });

  it("accepts a custom hex and flags an invalid one", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorSwatchPicker aria-label="Colour" colors={COLORS} allowCustom onValueChange={onChange} />);
    const hex = screen.getByRole("textbox", { name: "Custom colour (hex)" });
    await user.type(hex, "#12");
    expect(hex).toHaveAttribute("aria-invalid", "true");
    await user.type(hex, "3");
    expect(onChange).toHaveBeenLastCalledWith("#112233");
    await user.clear(hex);
    await user.type(hex, "#E5A54B");
    expect(screen.getByRole("radio", { name: "Amber" })).toHaveAttribute("aria-checked", "true");
  });

  it("Checkbox takes a colour of its own", () => {
    render(<Checkbox label="Work" color="#e5a54b" defaultChecked />);
    const box = screen.getByRole("checkbox", { name: "Work" });
    expect(box.style.borderColor).toBe("rgb(229, 165, 75)");
    expect(box.style.getPropertyValue("--kore-checkbox")).toBe("#e5a54b");
    expect(box).toBeChecked();
  });
});

describe("AccountMenu without Kore ID", () => {
  it("shows only what the app passes, and no Kore ID item", async () => {
    const user = userEvent.setup();
    render(
      <AccountMenu user={{ email: "anna@example.com" }} onSignOut={() => {}}>
        <MenuItem>Settings</MenuItem>
        <MenuItem>Change password</MenuItem>
      </AccountMenu>,
    );
    await user.click(screen.getByRole("button", { name: /Account/ }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Settings", "Change password", "Sign out"]);
    expect(within(menu).queryByText("Kore ID account")).not.toBeInTheDocument();
  });
});

describe("StatusDot", () => {
  it("has sizes and a muted (acknowledged) variant", () => {
    const { container } = render(
      <>
        <StatusDot status="down" size="lg" muted label="Down (acknowledged)" />
        <StatusDot status="up" size="sm" />
      </>,
    );
    const [muted, small] = container.querySelectorAll("[aria-hidden='true']");
    expect(muted).toHaveAttribute("data-muted");
    expect(muted!.className).toContain("size-2.5");
    expect(muted!.querySelector("span:last-child")!.className).toContain("bg-status-down-muted");
    expect(small!.className).toContain("size-1.5");
    expect(screen.getByText("Down (acknowledged)").className).toContain("text-muted");
  });
});

describe("Toast fixes", () => {
  function DialogWithToast({ onUndo = vi.fn() }) {
    const toast = useToast();
    return (
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open</Button>
        </DialogTrigger>
        <DialogContent title="Rename">
          <DialogBody>
            <Button onClick={() => toast.show({ message: "Saved", action: { label: "Undo", onClick: onUndo } })}>Save</Button>
          </DialogBody>
        </DialogContent>
      </Dialog>
    );
  }

  it("the viewport lets clicks through; only the toast takes them", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <DialogWithToast />
      </ToastProvider>,
    );
    const region = screen.getByRole("region", { name: "Notifications" });
    expect(region.className).toContain("pointer-events-none");
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(await screen.findByRole("button", { name: "Save" }));
    const toast = (await screen.findByText("Saved")).closest("[data-kore-toast]")!;
    expect(toast.className).toContain("pointer-events-auto");
  });

  it("Escape closes the open dialog, not the toast", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <DialogWithToast />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("clicking the toast's action doesn't close the dialog under it", async () => {
    // jsdom has no stylesheet, so it can't see the toast's pointer-events: auto over the modal's body lock.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <DialogWithToast onUndo={onUndo} />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(await screen.findByRole("button", { name: "Save" }));
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "Rename" })).toBeInTheDocument();
  });

  it("Escape on a focused toast dismisses it (F8 focuses it)", async () => {
    const user = userEvent.setup();
    function Show() {
      const toast = useToast();
      return <Button onClick={() => toast.show({ message: "Copied" })}>Copy</Button>;
    }
    render(
      <ToastProvider>
        <Show />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await screen.findByText("Copied");
    await user.keyboard("{F8}");
    expect(screen.getByText("Copied").closest("[data-kore-toast]")).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Copied")).not.toBeInTheDocument());
  });
});
