import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LinkProvider } from "../lib/link";
import { AppShell } from "./AppShell";
import { SettingsLayout } from "./SettingsLayout";
import { Sidebar, SidebarItem, SidebarNav } from "./Sidebar";
import { TopBar } from "./TopBar";

describe("AppShell", () => {
  it("marks the current nav item and closes the drawer when an item is followed", async () => {
    const user = userEvent.setup();
    render(
      <AppShell
        brand={<span>Kore</span>}
        brandHref="/"
        topBar={<TopBar />}
        sidebar={
          <Sidebar>
            <SidebarNav label="Sections">
              <SidebarItem href="/files" active>
                My files
              </SidebarItem>
              <SidebarItem href="/trash">Trash</SidebarItem>
            </SidebarNav>
          </Sidebar>
        }
      >
        <p>Content</p>
      </AppShell>,
    );
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(within(nav).getByRole("link", { name: "My files" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Trash" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("main")).toHaveTextContent("Content");

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    const drawer = await screen.findByRole("dialog", { name: "Navigation" });
    const trash = within(drawer).getByRole("link", { name: "Trash" });
    trash.addEventListener("click", (e) => e.preventDefault());
    await user.click(trash);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("renders links through the configured link component", () => {
    const Spy = vi.fn(({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
      <a data-router href={href} {...rest}>
        {children}
      </a>
    ));
    render(
      <LinkProvider component={Spy}>
        <SidebarNav label="Sections">
          <SidebarItem href="/files">My files</SidebarItem>
        </SidebarNav>
      </LinkProvider>,
    );
    expect(screen.getByRole("link", { name: "My files" })).toHaveAttribute("data-router");
  });
});

describe("SettingsLayout", () => {
  it("renders link and button sections with aria-current on the current one", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <SettingsLayout
        current="profile"
        items={[
          { id: "profile", label: "Profile", href: "/account" },
          { id: "security", label: "Security", onSelect },
        ]}
      >
        <p>Body</p>
      </SettingsLayout>,
    );
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(nav).getByRole("link", { name: "Profile" })).toHaveAttribute("aria-current", "page");
    await user.click(within(nav).getByRole("button", { name: "Security" }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
