import {
  AppMark,
  AppShell,
  Avatar,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  CopyButton,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  EmptyState,
  Field,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  PageBody,
  PageHeader,
  Select,
  SectionHeader,
  Sidebar,
  SidebarItem,
  SidebarNav,
  StatusDot,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
  TopBar,
  Wordmark,
  productName,
  useToast,
  type AppId,
  type SortDirection,
} from "@qarasky/kore-ui";
import { Activity, AppWindow, KeyRound, LayoutDashboard, LogOut, MoreHorizontal, Plus, Search, Trash2, UserX, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { TopBarActions } from "../demo";

type User = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  disabled: boolean;
  apps: AppId[];
  lastSignIn: string;
  lastSort: number;
};

const USERS: User[] = [
  { id: "1", name: "Sky Qarasky", email: "sky@qarasky.dev", role: "admin", disabled: false, apps: ["kore", "koremind", "korecalendar", "flatline"], lastSignIn: "Just now", lastSort: 0 },
  { id: "2", name: "Anna Berg", email: "anna@northwind.example", role: "user", disabled: false, apps: ["kore", "korecalendar"], lastSignIn: "Today 07:43", lastSort: 1 },
  { id: "3", name: "Lena Ivanova", email: "lena@northwind.example", role: "user", disabled: false, apps: ["kore", "koremind"], lastSignIn: "Yesterday", lastSort: 2 },
  { id: "4", name: "Tom Okafor", email: "tom@northwind.example", role: "admin", disabled: false, apps: ["flatline"], lastSignIn: "Oct 28", lastSort: 3 },
  { id: "5", name: "Marat Sultanov", email: "marat@northwind.example", role: "user", disabled: true, apps: ["kore"], lastSignIn: "Sep 12", lastSort: 4 },
  { id: "6", name: "Dana Lee", email: "dana@northwind.example", role: "user", disabled: false, apps: [], lastSignIn: "Never", lastSort: 9 },
];

type SortKey = "name" | "lastSignIn";

export function AdminSidebar({ current }: { current: string }) {
  return (
    <Sidebar>
      <SidebarNav label="Admin">
        <SidebarItem href="#/users" icon={<LayoutDashboard />} active={current === "overview"}>
          Overview
        </SidebarItem>
        <SidebarItem href="#/users" icon={<Users />} active={current === "users"} trailing="6">
          Users
        </SidebarItem>
        <SidebarItem href="#/users" icon={<AppWindow />} active={current === "apps"}>
          Apps
        </SidebarItem>
        <SidebarItem href="#/users" icon={<Activity />} active={current === "activity"}>
          Activity
        </SidebarItem>
      </SidebarNav>
    </Sidebar>
  );
}

export function UsersPage() {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDirection }>({ key: "name", dir: "asc" });
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = USERS.filter(
      (u) =>
        (role === "all" || (role === "disabled" ? u.disabled : u.role === role && !u.disabled)) &&
        (!q || u.name.toLowerCase().includes(q) || u.email.includes(q)),
    );
    const dir = sort.dir === "asc" ? 1 : -1;
    return list.sort((a, b) =>
      sort.key === "name" ? a.name.localeCompare(b.name) * dir : (a.lastSort - b.lastSort) * dir,
    );
  }, [query, role, sort]);

  const sortBy = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));

  return (
    <AppShell
      brand={<Wordmark app="kore-id" />}
      brandHref="#/users"
      topBar={<TopBar actions={<TopBarActions current="kore" />} />}
      sidebar={<AdminSidebar current="users" />}
    >
      <PageHeader title="Users" breadcrumbs={[{ label: "Admin", href: "#/users" }]} />
      <PageBody>
        <SectionHeader
          title="Users"
          description="6 users · 5 active"
          actions={
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus /> Add user
            </Button>
          }
        />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            size="sm"
            leadingIcon={<Search />}
            placeholder="Search by name or email"
            aria-label="Search users"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-[320px]"
          />
          <Select
            size="sm"
            aria-label="Role"
            value={role}
            onValueChange={setRole}
            className="w-[160px]"
            options={[
              { value: "all", label: "All users" },
              { value: "admin", label: "Admins" },
              { value: "user", label: "Users" },
              { value: "disabled", label: "Disabled" },
            ]}
          />
        </div>
        <Table caption="Users" className="min-w-[860px]">
          <TableHeader>
            <tr>
              <TableHead onSort={() => sortBy("name")} sorted={sort.key === "name" && sort.dir}>
                Name
              </TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Apps</TableHead>
              <TableHead onSort={() => sortBy("lastSignIn")} sorted={sort.key === "lastSignIn" && sort.dir}>
                Last sign-in
              </TableHead>
              <TableHead className="w-[56px]">
                <span className="sr-only">Actions</span>
              </TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={6}>No users match “{query}”.</TableEmpty>
            ) : (
              rows.map((u) => (
                <TableRow key={u.id} interactive>
                  <TableRowHeader>
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar name={u.name} email={u.email} size="sm" />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="truncate">{u.name}</span>
                          {u.id === "1" ? <Badge tone="accent">You</Badge> : null}
                        </span>
                        <span className="block truncate text-meta text-muted">{u.email}</span>
                      </span>
                    </span>
                  </TableRowHeader>
                  <TableCell muted>{u.role === "admin" ? "Admin" : "User"}</TableCell>
                  <TableCell>
                    {u.disabled ? <StatusDot status="off" label="Disabled" /> : <StatusDot status="up" label="Active" tintLabel={false} />}
                  </TableCell>
                  <TableCell>
                    {u.apps.length === 0 ? (
                      <span className="text-muted">No apps</span>
                    ) : (
                      <span className="flex items-center gap-2" aria-label={u.apps.map((a) => productName(a)).join(", ")}>
                        {u.apps.map((a) => (
                          <AppMark key={a} app={a} size={16} />
                        ))}
                      </span>
                    )}
                  </TableCell>
                  <TableCell muted className="whitespace-nowrap">
                    {u.lastSignIn}
                  </TableCell>
                  <TableCell className="pr-2!">
                    <Menu>
                      <MenuTrigger asChild>
                        <IconButton label={`Actions for ${u.name}`} tooltip={false} icon={<MoreHorizontal />} />
                      </MenuTrigger>
                      <MenuContent align="end">
                        <MenuItem icon={<KeyRound />} onSelect={() => setResetting(u)}>
                          Reset password
                        </MenuItem>
                        <MenuItem icon={<LogOut />} onSelect={() => toast.show({ message: `Signed ${u.name} out everywhere` })}>
                          Sign out everywhere
                        </MenuItem>
                        <MenuItem icon={<UserX />}>{u.disabled ? "Enable" : "Disable"}</MenuItem>
                        <MenuSeparator />
                        <MenuItem danger icon={<Trash2 />}>
                          Delete user
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <div className="mt-10 rounded-overlay border border-dashed border-border">
          <EmptyState
            icon={<AppWindow />}
            title="No audit events yet"
            description="Sign-ins, failed sign-ins and admin actions show up here."
          />
        </div>
      </PageBody>

      <Dialog
        open={adding}
        onOpenChange={(open) => {
          setAdding(open);
          if (!open) setCreated(null);
        }}
      >
        <DialogContent
          title={created ? "User added" : "Add user"}
          description={created ? "Copy this setup link and send it to them. It works once, for 24 hours, and is not shown again." : "They set their own password from a one-time setup link."}
        >
          {created ? (
            <>
              <DialogBody>
                <div className="flex items-center gap-2">
                  <Input readOnly value={created} aria-label="Setup link" className="font-mono text-meta" />
                  <CopyButton value={created} />
                </div>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="primary">Done</Button>
                </DialogClose>
              </DialogFooter>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setCreated("https://id.qarasky.dev/setup/q8Zt1vR0yXo3kP2mN7aLcE5wH9sJ4uB6");
              }}
            >
              <DialogBody className="flex flex-col gap-4">
                <Field label="Name">
                  <Input name="name" autoComplete="off" />
                </Field>
                <Field label="Email" hint="Their sign-in name. Only admins can change it later." required>
                  <Input name="email" type="email" autoComplete="off" />
                </Field>
                <Field label="Role">
                  <Select defaultValue="user" options={[{ value: "user", label: "User" }, { value: "admin", label: "Admin" }]} />
                </Field>
                <fieldset className="flex flex-col gap-0.5">
                  <legend className="mb-1.5 text-meta font-medium text-muted">Apps</legend>
                  {(["kore", "koremind", "korecalendar", "flatline"] as const).map((a) => (
                    <Checkbox key={a} label={productName(a)} defaultChecked={a === "kore"} />
                  ))}
                </fieldset>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button>Cancel</Button>
                </DialogClose>
                <Button type="submit" variant="primary">
                  Add user
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={resetting !== null}
        onOpenChange={(o) => !o && setResetting(null)}
        title={`Reset ${resetting?.name}'s password?`}
        description="Their current password stops working and they are signed out everywhere. You get a new setup link to send them."
        confirmLabel="Reset password"
        danger
        onConfirm={() => new Promise((r) => setTimeout(r, 500))}
      />
    </AppShell>
  );
}
