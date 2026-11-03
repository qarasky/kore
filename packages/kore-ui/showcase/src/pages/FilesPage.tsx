import {
  AppShell,
  Button,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  Field,
  IconButton,
  Input,
  Meter,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  PageHeader,
  Sidebar,
  SidebarItem,
  SidebarNav,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
  TopBar,
  Wordmark,
  useToast,
} from "@qarasky/kore-ui";
import {
  Download,
  FileArchive,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useState } from "react";
import { TopBarActions } from "../demo";

type Row = { name: string; kind: "folder" | "doc" | "zip"; modified: string; size: string };

const ROWS: Row[] = [
  { name: "Campaign shots", kind: "folder", modified: "Today 07:43", size: "60 KB" },
  { name: "Clients", kind: "folder", modified: "Today 07:43", size: "0 B" },
  { name: "Contracts", kind: "folder", modified: "Yesterday 18:02", size: "1.2 MB" },
  { name: "Invoices 2026", kind: "folder", modified: "Oct 28", size: "312 KB" },
  { name: "design-assets.zip", kind: "zip", modified: "Oct 21", size: "3 MB" },
  { name: "onboarding-checklist.md", kind: "doc", modified: "Oct 20", size: "115 B" },
  { name: "Q3 budget.csv", kind: "doc", modified: "Oct 3", size: "42 B" },
  { name: "Service agreement.pdf", kind: "doc", modified: "Sep 30", size: "15 KB" },
];

const ICON = {
  folder: <Folder className="size-icon fill-accent/90 text-accent" strokeWidth={1.5} />,
  doc: <FileText className="size-icon text-muted" strokeWidth={1.5} />,
  zip: <FileArchive className="size-icon text-warning" strokeWidth={1.5} />,
};

const COLLAPSED_KEY = "kore-showcase:sidebar-collapsed";

export function FilesPage() {
  const toast = useToast();
  // The app owns persistence: read it once, write what AppShell reports.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "1");
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [folderOpen, setFolderOpen] = useState(false);

  const actions = (row: Row) => [
    { id: "rename", label: "Rename", icon: <Pencil />, run: () => toast.show({ message: `Renamed “${row.name}”` }) },
    { id: "download", label: "Download", icon: <Download />, run: () => toast.show({ message: "Download started" }) },
    { id: "share", label: "Share link", icon: <Link2 />, run: () => toast.show({ message: "Link copied", tone: "success" }) },
  ];

  return (
    <AppShell
      brand={<Wordmark app="kore" />}
      brandHref="#/app"
      collapsible
      sidebarCollapsed={collapsed}
      onSidebarCollapsedChange={(next) => {
        setCollapsed(next);
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      }}
      topBar={
        <TopBar actions={<TopBarActions current="kore" />}>
          <Input variant="filled" leadingIcon={<Search />} placeholder="Search files" aria-label="Search files" className="max-w-[720px]" />
        </TopBar>
      }
      sidebar={
        <Sidebar
          header={
            <Menu>
              <MenuTrigger asChild>
                <Button variant="primary">
                  <Plus /> New
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={<FolderPlus />} onSelect={() => setFolderOpen(true)}>
                  New folder
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={<Upload />}>Upload files</MenuItem>
              </MenuContent>
            </Menu>
          }
          collapsedHeader={
            <Menu>
              <MenuTrigger asChild>
                <IconButton label="New" variant="primary" size="md" icon={<Plus />} />
              </MenuTrigger>
              <MenuContent side="right" align="start">
                <MenuItem icon={<FolderPlus />} onSelect={() => setFolderOpen(true)}>
                  New folder
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={<Upload />}>Upload files</MenuItem>
              </MenuContent>
            </Menu>
          }
          footer={<Meter label="Storage" value={12} max={64} valueText="12 MB of 64 MB used" className="px-3" />}
          collapsedFooter={<Meter label="Storage" hideLabel value={12} max={64} aria-label="Storage: 12 MB of 64 MB used" className="px-1" />}
        >
          <SidebarNav label="Sections">
            <SidebarItem href="#/app" icon={<HardDrive />} active>
              My files
            </SidebarItem>
            <SidebarItem href="#/app" icon={<Users />}>
              Shared space
            </SidebarItem>
            <SidebarItem href="#/app" icon={<Link2 />} trailing="3">
              Shared links
            </SidebarItem>
            <SidebarItem href="#/app" icon={<Trash2 />}>
              Trash
            </SidebarItem>
            <SidebarItem href="#/users" icon={<Shield />}>
              Admin
            </SidebarItem>
          </SidebarNav>
        </Sidebar>
      }
    >
      <PageHeader
        title="My files"
        meta="8 items"
        actions={
          <>
            <IconButton label="Upload files" icon={<Upload />} />
            <IconButton label="New folder" icon={<FolderPlus />} onClick={() => setFolderOpen(true)} />
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Table caption="Files in My files" framed={false}>
          <TableHeader>
            <tr>
              <TableHead className="pl-[54px]!">Name</TableHead>
              <TableHead className="w-[160px] max-sm:hidden">Modified</TableHead>
              <TableHead align="right" className="w-[100px]">
                Size
              </TableHead>
              <TableHead className="w-[56px]">
                <span className="sr-only">Actions</span>
              </TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {ROWS.map((row) => (
              <ContextMenu key={row.name}>
                <ContextMenuTrigger asChild>
                  <TableRow interactive>
                    <TableRowHeader>
                      <span className="flex min-w-0 items-center gap-3">
                        {ICON[row.kind]}
                        <span className="truncate">{row.name}</span>
                      </span>
                    </TableRowHeader>
                    <TableCell muted className="max-sm:hidden">
                      {row.modified}
                    </TableCell>
                    <TableCell align="right" muted>
                      {row.size}
                    </TableCell>
                    <TableCell className="pr-2!">
                      <Menu>
                        <MenuTrigger asChild>
                          <IconButton label={`Actions for ${row.name}`} tooltip={false} icon={<MoreHorizontal />} />
                        </MenuTrigger>
                        <MenuContent align="end">
                          {actions(row).map((a) => (
                            <MenuItem key={a.id} icon={a.icon} onSelect={a.run}>
                              {a.label}
                            </MenuItem>
                          ))}
                          <MenuSeparator />
                          <MenuItem danger icon={<Trash2 />} onSelect={() => setDeleting(row)}>
                            Move to trash
                          </MenuItem>
                        </MenuContent>
                      </Menu>
                    </TableCell>
                  </TableRow>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  {actions(row).map((a) => (
                    <ContextMenuItem key={a.id} icon={a.icon} onSelect={a.run}>
                      {a.label}
                    </ContextMenuItem>
                  ))}
                  <ContextMenuSeparator />
                  <ContextMenuItem danger icon={<Trash2 />} onSelect={() => setDeleting(row)}>
                    Move to trash
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Move “${deleting?.name}” to trash?`}
        description="You can restore it from Trash for 30 days."
        confirmLabel="Move to trash"
        danger
        onConfirm={async () => {
          await new Promise((r) => setTimeout(r, 600));
          toast.show({
            message: `Moved “${deleting?.name}” to trash`,
            action: { label: "Undo", onClick: () => new Promise((r) => setTimeout(r, 500)) },
          });
        }}
      />

      <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
        <DialogContent title="New folder" size="sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setFolderOpen(false);
              toast.show({ message: "Folder created", tone: "success" });
            }}
          >
            <DialogBody>
              <Field label="Name">
                <Input name="name" defaultValue="Untitled folder" autoFocus />
              </Field>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <Button type="submit" variant="primary">
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
