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

describe("collapsible sidebar", () => {
  function Shell(props: { collapsed?: boolean; onChange?: (c: boolean) => void }) {
    return (
      <AppShell
        brand={<span>Kore</span>}
        collapsible
        sidebarCollapsed={props.collapsed}
        onSidebarCollapsedChange={props.onChange}
        topBar={<TopBar />}
        sidebar={
          <Sidebar header={<button type="button">New</button>} footer={<p>Storage</p>}>
            <SidebarNav label="Sections" title="Files">
              <SidebarItem href="/files" active trailing="3">
                My files
              </SidebarItem>
            </SidebarNav>
          </Sidebar>
        }
      >
        <p>Content</p>
      </AppShell>
    );
  }

  it("reports toggles through onSidebarCollapsedChange (the app owns the state)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<Shell collapsed={false} onChange={onChange} />);
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
    // Controlled: nothing changes until the app passes the new state back.
    expect(screen.getByText("Files")).toBeInTheDocument();
    rerender(<Shell collapsed onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");
  });

  it("shows icons only when collapsed, keeps accessible names and adds tooltips", async () => {
    render(<Shell collapsed />);
    const nav = screen.getByRole("navigation", { name: "Sections" });
    const link = within(nav).getByRole("link", { name: "My files" });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText("Files")).not.toBeInTheDocument();
    expect(screen.queryByText("3")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
    expect(screen.queryByText("Storage")).not.toBeInTheDocument();
    link.focus();
    await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent("My files"));
  });

  it("uncontrolled: toggles itself", async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(screen.queryByText("Files")).not.toBeInTheDocument();
  });
});
