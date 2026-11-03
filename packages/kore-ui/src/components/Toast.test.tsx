import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast, type ToastInput } from "./Toast";

function Trigger({ input }: { input: ToastInput }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast.show(input)}>
      Do it
    </button>
  );
}

describe("Toast", () => {
  it("shows a message in a live region and dismisses it", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger input={{ message: "Link copied" }} />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Do it" }));
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
    // Radix announces the toast through a polite live region.
    await waitFor(() =>
      expect(screen.getAllByRole("status").some((el) => el.textContent?.includes("Link copied"))).toBe(true),
    );
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByText("Link copied")).not.toBeInTheDocument());
  });

  it("runs the action, then closes", async () => {
    const user = userEvent.setup();
    const undo = vi.fn(() => Promise.resolve());
    render(
      <ToastProvider>
        <Trigger input={{ message: "Moved to Trash", action: { label: "Undo", onClick: undo } }} />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Do it" }));
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByText("Moved to Trash")).not.toBeInTheDocument());
  });

  it("replaces the current toast with a new one and hides after its duration", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    function Two() {
      const toast = useToast();
      return (
        <>
          <button type="button" onClick={() => toast.show({ message: "First", duration: 1000 })}>
            one
          </button>
          <button type="button" onClick={() => toast.show({ message: "Second", duration: 1000, tone: "error" })}>
            two
          </button>
        </>
      );
    }
    render(
      <ToastProvider>
        <Two />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "one" }));
    expect(await screen.findByText("First")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "two" }));
    expect(await screen.findByText("Second")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("First")).not.toBeInTheDocument());
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await waitFor(() => expect(screen.queryByText("Second")).not.toBeInTheDocument());
    vi.useRealTimers();
  });

  it("throws a clear error outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Trigger input={{ message: "x" }} />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
