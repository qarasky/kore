import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogTrigger, DialogClose } from "./Dialog";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "./Menu";

describe("Dialog", () => {
  function Example() {
    return (
      <Dialog>
        <DialogTrigger asChild>
          <Button>Add user</Button>
        </DialogTrigger>
        <DialogContent title="Add user" description="They get a setup link.">
          <DialogBody>
            <input aria-label="Email" />
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  it("opens with a name and description, closes on Escape, and returns focus to the opener", async () => {
    const user = userEvent.setup();
    render(<Example />);
    const opener = screen.getByRole("button", { name: "Add user" });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Add user" });
    expect(dialog).toHaveAccessibleDescription("They get a setup link.");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("closes from the × button and from a DialogClose", async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole("button", { name: "Add user" }));
    await user.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Add user" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("ConfirmDialog", () => {
  it("focuses Cancel first, disables both buttons while confirming, then closes", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Delete</Button>
          <ConfirmDialog
            open={open}
            onOpenChange={setOpen}
            title="Delete “notes.md”?"
            description="It moves to Trash."
            confirmLabel="Delete"
            danger
            onConfirm={onConfirm}
          />
        </>
      );
    }
    render(<Example />);
    const opener = screen.getByRole("button", { name: "Delete" });
    await user.click(opener);
    const dialog = await screen.findByRole("alertdialog", { name: "Delete “notes.md”?" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveFocus();
    const buttons = dialog.querySelectorAll("button");
    await user.click(buttons[buttons.length - 1]!);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(cancel).toBeDisabled();
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("stays open when onConfirm throws", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        trigger={<Button>Reset</Button>}
        title="Reset password?"
        confirmLabel="Reset password"
        onConfirm={() => Promise.reject(new Error("nope"))}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Reset" }));
    await user.click(await screen.findByRole("button", { name: "Reset password" }));
    expect(await screen.findByRole("button", { name: "Reset password" })).toBeEnabled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});

describe("Menu", () => {
  it("opens from the keyboard, moves with arrows, selects with Enter and returns focus", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const onDelete = vi.fn();
    render(
      <Menu>
        <MenuTrigger asChild>
          <Button>Actions</Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={onRename}>Rename</MenuItem>
          <MenuItem disabled>Move</MenuItem>
          <MenuItem danger onSelect={onDelete}>
            Delete
          </MenuItem>
        </MenuContent>
      </Menu>,
    );
    const trigger = screen.getByRole("button", { name: "Actions" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    expect(menu).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus());
    // Disabled items are skipped.
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onRename).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("closes on Escape without selecting", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <Menu>
        <MenuTrigger asChild>
          <Button>Actions</Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={onRename}>Rename</MenuItem>
        </MenuContent>
      </Menu>,
    );
    const trigger = screen.getByRole("button", { name: "Actions" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    await screen.findByRole("menu");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(onRename).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });
});
