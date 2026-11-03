import {
  AccountMenu,
  AppMark,
  AppSwitcher,
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  ColorSwatchPicker,
  Combobox,
  CommandPalette,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  CopyButton,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  Kbd,
  Menu,
  Meter,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  NavTabs,
  PageHeader,
  PasswordInput,
  PointMenu,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetTrigger,
  minLengthRule,
  pointFromEvent,
  type MenuPoint,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  RadioGroup,
  RadioGroupItem,
  SectionHeader,
  Select,
  SelectGroup,
  SelectItem,
  Skeleton,
  Spinner,
  StatusDot,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  Wordmark,
  KORE_APP_IDS,
  useToast,
  type ProductId,
} from "@qarasky/kore-ui";
import {
  Archive,
  Copy,
  Download,
  FolderOpen,
  HardDrive,
  Inbox,
  KeyRound,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  Share2,
  Trash2,
  Upload,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { ACCOUNT_URL, APP_URLS, ME, PAGES } from "../demo";
import { TIME_ZONES, searchPeople } from "../timezones";

function Section({ id, title, children, note }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 border-t border-border py-8">
      <h2 className="text-title font-semibold tracking-[-0.01em]">{title}</h2>
      {note ? <p className="mt-1 text-sub text-muted">{note}</p> : null}
      <div className="mt-5 flex flex-col gap-5">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid items-start gap-3 md:grid-cols-[140px_1fr]">
      <p className="pt-2 text-meta text-muted">{label}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

const PRODUCTS: ProductId[] = [...KORE_APP_IDS, "kore-id"];

export function Gallery() {
  const toast = useToast();
  const [checked, setChecked] = useState<boolean | "indeterminate">("indeterminate");
  const [showHints, setShowHints] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [point, setPoint] = useState<MenuPoint | null>(null);
  const [colour, setColour] = useState("#5b8def");

  return (
    <div className="mx-auto max-w-[1100px] px-6 pb-24">
      <header className="flex flex-wrap items-center gap-4 py-6">
        <div className="text-brand">
          <Wordmark app="kore" />
        </div>
        <span className="text-muted">kore-ui 0.2.0</span>
        <nav aria-label="Showcase pages" className="ml-auto flex flex-wrap gap-1">
          {PAGES.map((p) => (
            <a key={p.href} href={p.href} className="rounded-ui px-3 py-1.5 text-sub text-muted hover:bg-white/5 hover:text-text">
              {p.label}
            </a>
          ))}
        </nav>
      </header>

      <Section id="tokens" title="Tokens" note="Dark only. Surfaces step up from bg to raised; hairlines, one accent.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {[
            ["bg", "bg-bg"],
            ["surface", "bg-surface"],
            ["raised", "bg-raised"],
            ["border", "bg-border"],
            ["border-strong", "bg-border-strong"],
            ["text", "bg-text"],
            ["muted", "bg-muted"],
            ["accent", "bg-accent"],
            ["accent-hover", "bg-accent-hover"],
            ["danger", "bg-danger"],
            ["danger-solid", "bg-danger-solid"],
            ["warning", "bg-warning"],
            ["status-up", "bg-status-up"],
            ["status-warn", "bg-status-warn"],
            ["status-down", "bg-status-down"],
            ["status-maint", "bg-status-maint"],
            ["status-off", "bg-status-off"],
          ].map(([name, cls]) => (
            <div key={name} className="overflow-hidden rounded-ui border border-border">
              <div className={`h-12 ${cls}`} />
              <p className="px-2 py-1.5 text-2xs text-muted">{name}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-display font-semibold tracking-[-0.02em]">Display 24 · What's on your mind?</p>
          <p className="text-brand font-semibold tracking-[-0.03em]">Brand 18 · Kore</p>
          <p className="text-title font-semibold tracking-[-0.01em]">Title 17 · Add user</p>
          <p className="text-heading font-semibold">Heading 16 · My files</p>
          <p>Body 15 · The quick brown fox jumps over the lazy dog.</p>
          <p className="text-sub">Sub 14 · Settings rows and compact controls.</p>
          <p className="text-meta text-muted">Meta 13 · Labels, column headers, hints.</p>
          <p className="text-2xs text-muted">2xs 12 · Badges, counters.</p>
        </div>
      </Section>

      <Section id="brand" title="Marks and wordmarks">
        <Row label="Marks">
          {PRODUCTS.map((p) => (
            <AppMark key={p} app={p} size={28} title={p} />
          ))}
        </Row>
        <Row label="Wordmarks">
          {PRODUCTS.map((p) => (
            <span key={p} className="text-brand">
              <Wordmark app={p} />
            </span>
          ))}
        </Row>
      </Section>

      <Section id="buttons" title="Button and IconButton" note="One primary per view. Labels are verbs.">
        {(["primary", "secondary", "ghost", "danger", "danger-outline", "link"] as const).map((v) => (
          <Row key={v} label={v}>
            <Button variant={v}>{v === "danger" ? "Delete" : "Save changes"}</Button>
            <Button variant={v}>
              <Plus /> With icon
            </Button>
            <Button variant={v} size="sm">
              Small
            </Button>
            <Button variant={v} disabled>
              Disabled
            </Button>
            <Button variant={v} loading>
              Saving…
            </Button>
          </Row>
        ))}
        <Row label="asChild (link)">
          <Button asChild variant="secondary">
            <a href="#/app">Open app shell</a>
          </Button>
        </Row>
        <Row label="IconButton">
          <IconButton label="Edit" icon={<Pencil />} />
          <IconButton label="Share" icon={<Share2 />} variant="secondary" />
          <IconButton label="Upload" icon={<Upload />} size="md" />
          <IconButton label="New" icon={<Plus />} variant="primary" size="md" />
          <IconButton label="Delete" icon={<Trash2 />} variant="danger" />
          <IconButton label="Disabled" icon={<Download />} disabled />
        </Row>
      </Section>

      <Section id="forms" title="Form controls" note="Labels above, hints below; the error replaces the hint and is announced.">
        <div className="grid gap-6 md:grid-cols-2">
          <Field label="Name" hint="Shown to other people.">
            <Input placeholder="Anna Berg" />
          </Field>
          <Field label="Email" error="Enter an email address like name@example.com.">
            <Input type="email" defaultValue="anna@" />
          </Field>
          <Field label="Search" labelAside={<Kbd>/</Kbd>}>
            <Input leadingIcon={<Search />} placeholder="Search files" />
          </Field>
          <Field label="Disabled" hint="Only an admin can change this.">
            <Input defaultValue="sky@qarasky.dev" disabled />
          </Field>
          <Field label="Filled (top-bar search)">
            <Input variant="filled" leadingIcon={<Search />} placeholder="Search files" />
          </Field>
          <Field label="Small" hint="32px, for toolbars and table filters.">
            <Input size="sm" placeholder="Filter" />
          </Field>
          <Field label="Notes" hint="Markdown is fine.">
            <Textarea placeholder="Anything it should always know" />
          </Field>
          <div className="flex flex-col gap-6">
            <Field label="Role">
              <Select
                defaultValue="user"
                options={[
                  { value: "user", label: "User" },
                  { value: "admin", label: "Admin" },
                  { value: "owner", label: "Owner", disabled: true },
                ]}
              />
            </Field>
            <Field label="Time zone" error="Pick a time zone.">
              <Select placeholder="Choose a time zone">
                <SelectGroup label="Asia">
                  <SelectItem value="almaty">Almaty</SelectItem>
                  <SelectItem value="tokyo">Tokyo</SelectItem>
                </SelectGroup>
                <SelectGroup label="Europe">
                  <SelectItem value="berlin">Berlin</SelectItem>
                </SelectGroup>
              </Select>
            </Field>
          </div>
        </div>
        <div id="password-colour" className="grid gap-6 md:grid-cols-2">
          <Field label="Password">
            <PasswordInput defaultValue="hunter2hunter2" />
          </Field>
          <Field label="New password" hint="Pick something you don't use elsewhere.">
            <PasswordInput
              newPassword
              defaultValue="correct horse"
              rules={[minLengthRule(10), { label: "Not only letters", test: (p) => /[^a-z]/i.test(p.replace(/ /g, "")) }]}
            />
          </Field>
          <Field label="Calendar colour" hint={`Selected: ${colour}`}>
            <ColorSwatchPicker
              value={colour}
              onValueChange={setColour}
              allowCustom
              colors={[
                { value: "#5b8def", label: "Blue" },
                { value: "#3fb950", label: "Green" },
                { value: "#e5a54b", label: "Amber" },
                { value: "#f2777a", label: "Red" },
                { value: "#a371f7", label: "Violet" },
                { value: "#2bb3c0", label: "Teal" },
                { value: "#e6e8ee", label: "Light" },
              ]}
            />
          </Field>
          <fieldset className="flex flex-col">
            <legend className="mb-1.5 text-meta font-medium text-muted">Coloured checkboxes (calendar list)</legend>
            <Checkbox label="Work" color="#5b8def" defaultChecked />
            <Checkbox label="Family" color="#3fb950" defaultChecked />
            <Checkbox label="Holidays" color="#e5a54b" />
            <Checkbox label="Light colour" color="#e6e8ee" defaultChecked />
          </fieldset>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="flex flex-col">
            <Checkbox label="Unchecked" />
            <Checkbox label="Checked" defaultChecked />
            <Checkbox label="Some selected" checked={checked} onCheckedChange={setChecked} />
            <Checkbox label="Disabled" disabled />
            <Checkbox label="Admin" description="Can add users and reset passwords." defaultChecked />
          </div>
          <div className="flex flex-col">
            <Switch label="Show hints" checked={showHints} onCheckedChange={setShowHints} />
            <Switch label="Off" />
            <Switch label="Disabled" disabled defaultChecked />
            <Switch label="Only free models" description="Hide paid models from the picker." defaultChecked />
          </div>
          <Field label="Density">
            <RadioGroup defaultValue="comfortable">
              <RadioGroupItem value="comfortable" label="Comfortable" description="48px rows." />
              <RadioGroupItem value="compact" label="Compact" description="32px rows." />
              <RadioGroupItem value="off" label="Disabled option" disabled />
            </RadioGroup>
          </Field>
        </div>
      </Section>

      <Section id="combobox" title="Combobox" note="Searchable single select for long or remote lists. Type to filter; arrows, Enter, Escape.">
        <div className="grid gap-6 md:grid-cols-3">
          <Field label="Time zone" hint={`${TIME_ZONES.length} zones, filtered locally (city, region, offset).`}>
            <Combobox options={TIME_ZONES} defaultValue="Asia/Almaty" searchPlaceholder="Search time zones"/>
          </Field>
          <Field label="Owner" hint="Async: searched on the server as you type.">
            <Combobox loadOptions={searchPeople} placeholder="Choose a person" searchPlaceholder="Search people" />
          </Field>
          <Field label="Calendar" error="Pick a calendar.">
            <Combobox
              placeholder="Choose a calendar"
              options={[
                { value: "work", label: "Work" },
                { value: "home", label: "Home" },
                { value: "shared", label: "Team (read-only)", disabled: true },
              ]}
            />
          </Field>
          <Field label="Disabled">
            <Combobox options={TIME_ZONES} defaultValue="Europe/Berlin" disabled />
          </Field>
          <Field label="Small" hint="32px, for toolbars.">
            <Combobox size="sm" options={TIME_ZONES} defaultValue="UTC" />
          </Field>
        </div>
      </Section>

      <Section id="meter" title="Meter and Progress" note="Meter: a measurement in a known range, warning at 80% and danger at 90% by default. Progress: a running task.">
        <div className="grid gap-8 md:grid-cols-3">
          <Meter label="Storage" value={12} max={64} valueText="12 MB of 64 MB used" />
          <Meter label="Storage" value={42} max={50} valueText="42 GB of 50 GB used" />
          <Meter label="Storage" value={49.5} max={50} valueText="49.5 GB of 50 GB used. Free up space to keep uploading." />
          <Meter label="Free-tier requests" value={70} thresholds={{ warning: 0.5, danger: 0.75 }} valueText="70 of 100 today" />
          <Progress label="Uploading 3 files" value={2} max={3} valueText="2 of 3 files" showLabel />
          <Progress label="Importing calendar" valueText="Importing…" showLabel />
        </div>
      </Section>

      <Section id="overlays" title="Dialog, ConfirmDialog, Menu, Popover, Tooltip">
        <Row label="Dialog">
          <Dialog>
            <DialogTrigger asChild>
              <Button data-testid="open-dialog">Rename</Button>
            </DialogTrigger>
            <DialogContent title="Rename file" description="Names must be unique in this folder.">
              <DialogBody>
                <Field label="Name">
                  <Input defaultValue="Q3 budget.csv" />
                </Field>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button>Cancel</Button>
                </DialogClose>
                <Button variant="primary">Rename</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <ConfirmDialog
            trigger={
              <Button variant="danger-outline" data-testid="open-confirm">
                Delete user
              </Button>
            }
            title="Delete lena@northwind.example?"
            description="Their files move to you. This can't be undone."
            confirmLabel="Delete user"
            danger
            onConfirm={() => new Promise((r) => setTimeout(r, 800))}
          />
        </Row>
        <Row label="Menu">
          <Menu>
            <MenuTrigger asChild>
              <Button data-testid="open-menu">
                Actions <MoreHorizontal />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Q3 budget.csv</MenuLabel>
              <MenuItem icon={<FolderOpen />} shortcut="↵">
                Open
              </MenuItem>
              <MenuItem icon={<Pencil />} shortcut="F2">
                Rename
              </MenuItem>
              <MenuItem icon={<Link2 />}>Copy link</MenuItem>
              <MenuItem icon={<Download />} disabled>
                Download (disabled)
              </MenuItem>
              <MenuSub>
                <MenuSubTrigger icon={<Share2 />}>Share with</MenuSubTrigger>
                <MenuSubContent>
                  <MenuItem>Anna Berg</MenuItem>
                  <MenuItem>Everyone</MenuItem>
                </MenuSubContent>
              </MenuSub>
              <MenuSeparator />
              <MenuCheckboxItem checked>Show hidden files</MenuCheckboxItem>
              <MenuSeparator />
              <MenuItem danger icon={<Trash2 />}>
                Move to trash
              </MenuItem>
            </MenuContent>
          </Menu>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                tabIndex={0}
                data-testid="context-area"
                className="flex h-control items-center rounded-ui border border-dashed border-border-strong px-4 text-meta text-muted"
              >
                Right-click here (or focus + Shift+F10)
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuLabel>Selection</ContextMenuLabel>
              <ContextMenuItem icon={<Copy />} shortcut="⌘C">
                Copy
              </ContextMenuItem>
              <ContextMenuSub>
                <ContextMenuSubTrigger icon={<Archive />}>Move to</ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <ContextMenuItem>Archive</ContextMenuItem>
                  <ContextMenuItem>Shared space</ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSeparator />
              <ContextMenuItem danger icon={<Trash2 />}>
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </Row>
        <Row label="PointMenu">
          <div
            tabIndex={0}
            data-testid="canvas"
            aria-label="Superboard canvas"
            onContextMenu={(e) => {
              e.preventDefault();
              setPoint(pointFromEvent(e));
            }}
            className="grid h-[120px] w-full max-w-[520px] place-items-center rounded-overlay border border-border bg-[radial-gradient(circle,var(--color-border)_1px,transparent_1px)] [background-size:16px_16px] text-meta text-muted"
          >
            A canvas that opens its own menu at the cursor
          </div>
          <PointMenu point={point} label="Actions for edge-02" onClose={() => setPoint(null)}>
            <MenuItem icon={<FolderOpen />}>Open history</MenuItem>
            <MenuItem icon={<Pencil />}>Rename</MenuItem>
            <MenuSeparator />
            <MenuItem danger icon={<Trash2 />}>
              Remove server
            </MenuItem>
          </PointMenu>
        </Row>
        <Row label="CommandPalette">
          <Button onClick={() => setPaletteOpen(true)} data-testid="open-palette">
            <Search /> Search <Kbd className="ml-1">⌘K</Kbd>
          </Button>
          <CommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            shortcut={false}
            groups={[
              {
                heading: "Go to",
                commands: [
                  { id: "files", label: "My files", icon: <HardDrive />, shortcut: "G F", onSelect: () => {} },
                  { id: "trash", label: "Trash", icon: <Trash2 />, shortcut: "G T", onSelect: () => {} },
                ],
              },
              {
                heading: "Actions",
                commands: [
                  { id: "upload", label: "Upload files", icon: <Upload />, shortcut: ["⌘", "U"], onSelect: () => {} },
                  { id: "pw", label: "Change password", icon: <KeyRound />, description: "Kore ID", onSelect: () => {} },
                ],
              },
            ]}
          />
        </Row>
        <Row label="Sheet">
          {(["right", "left"] as const).map((side) => (
            <Sheet key={side}>
              <SheetTrigger asChild>
                <Button data-testid={`open-sheet-${side}`}>From the {side}</Button>
              </SheetTrigger>
              <SheetContent title="edge-02" description="Server · Almaty · up for 12 days" side={side}>
                <SheetBody className="flex flex-col gap-4">
                  <StatusDot status="up" label="Up" tintLabel={false} />
                  <Field label="Display name">
                    <Input defaultValue="edge-02" />
                  </Field>
                  <p className="text-muted">Side panels keep the page in view: details, quick edits, filters.</p>
                </SheetBody>
                <SheetFooter>
                  <Button>Cancel</Button>
                  <Button variant="primary">Save</Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          ))}
        </Row>
        <Row label="Popover">
          <Popover>
            <PopoverTrigger asChild>
              <Button data-testid="open-popover">Event details</Button>
            </PopoverTrigger>
            <PopoverContent align="start">
              <p className="font-medium">Design review</p>
              <p className="mt-1 text-meta text-muted">Tue, Nov 4 · 14:00–15:00</p>
              <div className="mt-4 flex justify-end gap-2">
                <Button size="sm" variant="ghost">
                  Delete
                </Button>
                <Button size="sm">Edit</Button>
              </div>
            </PopoverContent>
          </Popover>
        </Row>
        <Row label="Tooltip">
          <Tooltip content="Upload files">
            <IconButton label="Upload" tooltip={false} icon={<Upload />} variant="secondary" data-testid="tooltip-trigger" />
          </Tooltip>
        </Row>
      </Section>

      <Section id="feedback" title="Toast, Spinner, Skeleton, EmptyState">
        <Row label="Toast">
          <Button onClick={() => toast.show({ message: "Link copied" })} data-testid="toast-info">
            Info
          </Button>
          <Button onClick={() => toast.show({ message: "Settings saved", tone: "success" })}>Success</Button>
          <Button onClick={() => toast.show({ message: "Couldn't move 2 files. The folder is full.", tone: "error" })}>
            Error
          </Button>
          <Button
            data-testid="toast-action"
            onClick={() =>
              toast.show({
                message: "Moved “Q3 budget.csv” to trash",
                action: { label: "Undo", onClick: () => new Promise((r) => setTimeout(r, 800)) },
              })
            }
          >
            With Undo
          </Button>
        </Row>
        <Row label="Spinner">
          <Spinner />
          <Spinner size={20} className="text-accent" label="Loading" />
          <span className="inline-flex items-center gap-2 text-muted">
            <Spinner size={14} /> Saving…
          </span>
        </Row>
        <Row label="Skeleton">
          <div className="flex w-full max-w-[420px] items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        </Row>
        <Card>
          <EmptyState
            icon={<Inbox />}
            title="No shared links yet"
            description="Share a file or folder to get a link anyone can open."
            action={
              <Button variant="primary">
                <Link2 /> Share a file
              </Button>
            }
          />
        </Card>
      </Section>

      <Section id="data" title="Badge, StatusDot, Avatar, Kbd, CopyButton, Table">
        <Row label="Badge">
          <Badge>Neutral</Badge>
          <Badge tone="accent">You</Badge>
          <Badge tone="success">Active</Badge>
          <Badge tone="warning">Free tier</Badge>
          <Badge tone="danger">Disabled</Badge>
          <Badge tone="maint">Maintenance</Badge>
          <Badge tone="outline">Admin</Badge>
        </Row>
        <Row label="StatusDot">
          <StatusDot status="up" label="Up" />
          <StatusDot status="warn" label="Degraded" />
          <StatusDot status="down" label="Down" />
          <StatusDot status="maint" label="Maintenance" />
          <StatusDot status="off" label="Not connected" />
          <StatusDot status="accent" label="Connected" />
          <StatusDot status="up" label="Live" pulse tintLabel={false} />
        </Row>
        <Row label="Sizes, muted">
          <StatusDot status="down" size="sm" label="Small" />
          <StatusDot status="down" label="Medium" />
          <StatusDot status="down" size="lg" label="Large" />
          <StatusDot status="down" muted label="Down (acknowledged)" />
        </Row>
        <Row label="Avatar">
          <Avatar name="Anna Berg" size="sm" />
          <Avatar name="Anna Berg" />
          <Avatar name="Anna Berg" size="lg" />
          <Avatar email="tom@northwind.example" />
          <Avatar name="Broken image" src="/nope.png" />
        </Row>
        <Row label="Kbd">
          <span className="inline-flex items-center gap-1 text-meta text-muted">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd> to search
          </span>
          <Kbd>Esc</Kbd>
        </Row>
        <Row label="CopyButton">
          <CopyButton value="https://id.qarasky.dev/setup/abc" />
          <CopyButton value="token" iconOnly label="Copy token" />
        </Row>
        <Table caption="Monitors">
          <TableHeader>
            <tr>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead align="right">Uptime</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableRowHeader>api.clients.kz</TableRowHeader>
              <TableCell>
                <StatusDot status="down" label="Down" />
              </TableCell>
              <TableCell align="right" muted>
                99.1%
              </TableCell>
            </TableRow>
            <TableRow selected>
              <TableRowHeader>gpu-01 (selected)</TableRowHeader>
              <TableCell>
                <StatusDot status="up" label="Up" tintLabel={false} />
              </TableCell>
              <TableCell align="right" muted>
                100.00%
              </TableCell>
            </TableRow>
            <TableRow interactive>
              <TableRowHeader>nas-01 (interactive)</TableRowHeader>
              <TableCell>
                <StatusDot status="maint" label="Maintenance" />
              </TableCell>
              <TableCell align="right" muted>
                97.2%
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Section>

      <Section id="navigation" title="Tabs, NavTabs, PageHeader, SectionHeader">
        <Tabs defaultValue="profile">
          <TabsList variant="underline" aria-label="User">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="apps">Apps</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
          </TabsList>
          <TabsContent value="profile" className="pt-4 text-muted">
            Underline tabs: sections inside a page.
          </TabsContent>
          <TabsContent value="apps" className="pt-4 text-muted">
            Apps tab.
          </TabsContent>
          <TabsContent value="security" className="pt-4 text-muted">
            Security tab.
          </TabsContent>
        </Tabs>
        <Tabs defaultValue="week">
          <TabsList aria-label="View">
            <TabsTrigger value="day">Day</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="month">Month</TabsTrigger>
          </TabsList>
        </Tabs>
        <Card className="overflow-hidden">
          <PageHeader
            title="Users"
            meta="4 users"
            tabs={
              <NavTabs
                label="Admin sections"
                items={[
                  { href: "#/components", label: "Overview" },
                  { href: "#/components", label: "Users", active: true },
                  { href: "#/components", label: "Settings" },
                ]}
              />
            }
            actions={
              <Button variant="primary" size="sm">
                <Plus /> Add user
              </Button>
            }
          />
          <PageHeader
            title="Invoices 2026"
            breadcrumbs={[{ label: "My files", href: "#/app" }, { label: "Clients", href: "#/app" }]}
            actions={<IconButton label="Settings" icon={<Settings />} />}
            className="border-b-0"
          />
        </Card>
        <SectionHeader title="Users" description="4 users" actions={<Button size="sm">Export</Button>} />
      </Section>

      <Section id="identity" title="AppSwitcher, AccountMenu" note="Top-bar identity controls. App URLs are configurable; apps without a URL are hidden.">
        <Row label="In a top bar">
          <div className="flex items-center gap-1.5 rounded-ui border border-border px-2 py-1">
            <AppSwitcher urls={APP_URLS} current="korecalendar" accountUrl={ACCOUNT_URL} />
            <AccountMenu user={ME} accountUrl={ACCOUNT_URL} apps={{ urls: APP_URLS, current: "korecalendar" }} onSignOut={() => void toast.show({ message: "Signed out" })} />
          </div>
          <AccountMenu user={{ email: "sky@qarasky.dev" }} accountUrl={ACCOUNT_URL} showName={false} onSignOut={() => {}} />
        </Row>
        <Row label="Without Kore ID">
          <AccountMenu user={{ name: "Local Admin", email: "admin@kore.test" }} onSignOut={() => {}} labels={{ menu: "Local account" }}>
            <MenuItem icon={<Settings />}>Settings</MenuItem>
            <MenuItem icon={<KeyRound />}>Change password</MenuItem>
          </AccountMenu>
        </Row>
      </Section>
    </div>
  );
}
