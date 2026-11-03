import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountMenu } from "./AccountMenu";
import { AppSwitcher } from "./AppSwitcher";
import { AuthScreen } from "./AuthScreen";

const urls = {
  kore: "https://files.example.com/",
  koremind: "https://mind.example.com/",
  korecalendar: "https://cal.example.com/",
};

describe("AppSwitcher", () => {
  it("lists only the apps that have a URL, links to them, and marks the current one", async () => {
    const user = userEvent.setup();
    render(<AppSwitcher urls={urls} current="korecalendar" accountUrl="https://id.example.com/account" />);
    await user.click(screen.getByRole("button", { name: "Apps" }));
    const list = await screen.findByRole("list", { name: "Kore apps" });
    const links = within(list).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([urls.kore, urls.koremind, urls.korecalendar]);
    expect(within(list).getByRole("link", { name: /KoreCalendar/ })).toHaveAttribute("aria-current", "page");
    expect(within(list).queryByRole("link", { name: /KoreMonitor/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Kore ID account" })).toHaveAttribute("href", "https://id.example.com/account");
  });

  it("uses name overrides", async () => {
    const user = userEvent.setup();
    render(<AppSwitcher urls={{ flatline: "https://up.example.com/" }} names={{ flatline: "Flatline" }} />);
    await user.click(screen.getByRole("button", { name: "Apps" }));
    expect(await screen.findByRole("link", { name: /Flatline/ })).toHaveAttribute("href", "https://up.example.com/");
  });
});

describe("AccountMenu", () => {
  it("shows the user, links to Kore ID and the other apps, and signs out", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    render(
      <AccountMenu
        user={{ name: "Anna Berg", email: "anna@example.com" }}
        accountUrl="https://id.example.com/account"
        apps={{ urls, current: "kore" }}
        onSignOut={onSignOut}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Account: Anna Berg" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("anna@example.com")).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Kore ID account" })).toHaveAttribute(
      "href",
      "https://id.example.com/account",
    );
    // The current app is not offered.
    expect(within(menu).queryByRole("menuitem", { name: "KoreDrive" })).not.toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "KoreMind" })).toHaveAttribute("href", urls.koremind);
    await user.click(within(menu).getByRole("menuitem", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});

describe("AuthScreen", () => {
  it("offers Kore ID as a link and submits the password form", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<AuthScreen app="kore" sso={{ href: "/api/auth/oidc/login" }} password={{ onSubmit }} />);
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue with Kore ID" })).toHaveAttribute("href", "/api/auth/oidc/login");
    await user.type(screen.getByLabelText("Email"), "anna@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSubmit).toHaveBeenCalledWith({ email: "anna@example.com", password: "correct horse" });
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled());
  });

  it("announces the error and ties it to the fields", () => {
    render(
      <AuthScreen
        password={{ onSubmit: () => {}, invalid: true }}
        error="That email and password don't match. Try again."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("That email and password don't match.");
    const email = screen.getByLabelText("Email");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("That email and password don't match. Try again.");
    // Without Kore ID, the password submit is the primary action.
    expect(screen.queryByRole("link", { name: /Kore ID/ })).not.toBeInTheDocument();
  });

  it("runs an SSO handler", async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    render(<AuthScreen sso={{ onClick: start, label: "Continue with Kore ID" }} />);
    await user.click(screen.getByRole("button", { name: "Continue with Kore ID" }));
    expect(start).toHaveBeenCalledOnce();
  });
});
