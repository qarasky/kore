import {
  AppGrid,
  AppShell,
  Avatar,
  Badge,
  Button,
  Field,
  Input,
  PageHeader,
  RadioGroup,
  RadioGroupItem,
  SettingsLayout,
  SettingsSection,
  Sidebar,
  SidebarItem,
  SidebarNav,
  Switch,
  TopBar,
  Wordmark,
  useToast,
} from "@qarasky/kore-ui";
import { AppWindow, Bell, KeyRound, Monitor, Smartphone, UserRound } from "lucide-react";
import { useState } from "react";
import { APP_URLS, ME, TopBarActions } from "../demo";

const SECTIONS = [
  { id: "profile", label: "Profile", icon: <UserRound /> },
  { id: "security", label: "Security", icon: <KeyRound /> },
  { id: "notifications", label: "Notifications", icon: <Bell /> },
  { id: "apps", label: "Your apps", icon: <AppWindow /> },
];

export function SettingsPage() {
  const toast = useToast();
  const [section, setSection] = useState("profile");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <AppShell
      brand={<Wordmark app="kore-id" />}
      brandHref="#/settings"
      topBar={<TopBar actions={<TopBarActions current="kore" />} />}
      sidebar={
        <Sidebar>
          <SidebarNav label="Kore ID">
            <SidebarItem href="#/settings" icon={<UserRound />} active>
              Account
            </SidebarItem>
            <SidebarItem href="#/users" icon={<AppWindow />}>
              Admin
            </SidebarItem>
          </SidebarNav>
        </Sidebar>
      }
    >
      <PageHeader title="Account" />
      <SettingsLayout current={section} items={SECTIONS.map((s) => ({ ...s, onSelect: () => setSection(s.id) }))}>
        {section === "profile" ? (
          <>
            <SettingsSection title="Profile" description="How you appear in every Kore app.">
              <div className="flex items-center gap-4">
                <Avatar name={ME.name} email={ME.email} size="lg" />
                <div>
                  <p className="font-medium">{ME.name}</p>
                  <p className="text-meta text-muted">
                    {ME.email} · <Badge tone="outline">User</Badge>
                  </p>
                </div>
              </div>
              <form
                className="flex flex-col gap-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
                  if (!name) {
                    setNameError("Enter your name.");
                    return;
                  }
                  setNameError(null);
                  setSaving(true);
                  await new Promise((r) => setTimeout(r, 600));
                  setSaving(false);
                  toast.show({ message: "Profile saved", tone: "success" });
                }}
              >
                <Field label="Name" error={nameError} hint="Shown to admins and in shared items.">
                  <Input name="name" defaultValue={ME.name} />
                </Field>
                <Field label="Email" hint="Only an admin can change your email.">
                  <Input value={ME.email} readOnly disabled />
                </Field>
                <div>
                  <Button type="submit" variant="primary" loading={saving}>
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              </form>
            </SettingsSection>
            <SettingsSection title="Preferences">
              <Switch label="Show keyboard shortcut hints" description="Hints appear in menus and tooltips." defaultChecked labelFirst />
              <Switch label="Reduce motion" description="Overrides your system setting in Kore apps." labelFirst />
              <Field label="Start page">
                <RadioGroup defaultValue="apps">
                  <RadioGroupItem value="apps" label="Your apps" description="A launcher with every app you can use." />
                  <RadioGroupItem value="account" label="Account" />
                </RadioGroup>
              </Field>
            </SettingsSection>
          </>
        ) : null}
        {section === "security" ? (
          <>
            <SettingsSection title="Password" description="At least 10 characters. Changing it keeps this session signed in.">
              <Field label="Current password">
                <Input type="password" autoComplete="current-password" />
              </Field>
              <Field label="New password" error="Use at least 10 characters.">
                <Input type="password" autoComplete="new-password" defaultValue="short" />
              </Field>
              <div>
                <Button variant="primary">Change password</Button>
              </div>
            </SettingsSection>
            <SettingsSection
              title="Active sessions"
              description="Signed in on these devices."
              actions={<Button size="sm" variant="danger-outline">Sign out everywhere</Button>}
            >
              {[
                { icon: <Monitor />, name: "Firefox on macOS", meta: "Almaty · This device", current: true },
                { icon: <Smartphone />, name: "KoreCalendar for Android", meta: "Last active 2 hours ago", current: false },
              ].map((s) => (
                <div key={s.name} className="flex min-h-row items-center gap-3">
                  <span className="text-muted [&_svg]:size-5">{s.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{s.name}</p>
                    <p className="text-meta text-muted">{s.meta}</p>
                  </div>
                  {s.current ? <Badge tone="accent">This device</Badge> : <Button size="sm">Sign out</Button>}
                </div>
              ))}
            </SettingsSection>
          </>
        ) : null}
        {section === "notifications" ? (
          <SettingsSection title="Notifications" description="Kore ID never sends email; these are in-app only.">
            <Switch label="New sign-in on another device" defaultChecked labelFirst />
          </SettingsSection>
        ) : null}
        {section === "apps" ? (
          <SettingsSection title="Your apps" description="Apps your account can open.">
            <AppGrid urls={APP_URLS} className="grid-cols-2 sm:grid-cols-4" />
          </SettingsSection>
        ) : null}
      </SettingsLayout>
    </AppShell>
  );
}
