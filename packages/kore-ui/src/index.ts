// @qarasky/kore-ui: the Kore design system. See DESIGN.md.

// Utilities and setup
export { cn } from "./lib/cn";
export { KoreProvider, type KoreProviderProps } from "./lib/KoreProvider";
export { LinkProvider, useLinkComponent, isExternalHref, type LinkComponent, type LinkProps } from "./lib/link";

// Primitives
export { Button, buttonVariants, type ButtonProps } from "./components/Button";
export { IconButton, iconButtonVariants, type IconButtonProps } from "./components/IconButton";
export { Input, Textarea, controlClass, type InputProps, type TextareaProps } from "./components/Input";
export { Field, useField, useFieldControl, type FieldProps } from "./components/Field";
export { Select, SelectItem, SelectGroup, type SelectProps, type SelectOption } from "./components/Select";
export { Checkbox, type CheckboxProps } from "./components/Checkbox";
export { Switch, type SwitchProps } from "./components/Switch";
export { RadioGroup, RadioGroupItem, type RadioGroupProps, type RadioGroupItemProps } from "./components/RadioGroup";
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogBody,
  DialogFooter,
  type DialogContentProps,
} from "./components/Dialog";
export { ConfirmDialog, type ConfirmDialogProps } from "./components/ConfirmDialog";
export {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  MenuCheckboxItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuLabel,
  MenuSeparator,
  MenuGroup,
  MenuSub,
  MenuSubTrigger,
  MenuSubContent,
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuGroup,
  menuClasses,
  type MenuItemProps,
} from "./components/Menu";
export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverClose, type PopoverContentProps } from "./components/Popover";
export { Tooltip, TooltipProvider, type TooltipProps } from "./components/Tooltip";
export { Tabs, TabsList, TabsTrigger, TabsContent, NavTabs, type TabsListProps, type NavTabsProps, type NavTabItem } from "./components/Tabs";
export { ToastProvider, useToast, type ToastApi, type ToastInput, type ToastTone, type ToastProviderProps } from "./components/Toast";
export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableRowHeader,
  TableEmpty,
  type TableProps,
  type TableHeadProps,
  type TableCellProps,
  type TableRowProps,
  type SortDirection,
} from "./components/Table";
export { Badge, badgeVariants, type BadgeProps } from "./components/Badge";
export { StatusDot, type Status, type StatusDotProps } from "./components/StatusDot";
export { Avatar, initials, type AvatarProps } from "./components/Avatar";
export { EmptyState, type EmptyStateProps } from "./components/EmptyState";
export { Spinner, type SpinnerProps } from "./components/Spinner";
export { Skeleton } from "./components/Skeleton";
export { Kbd } from "./components/Kbd";
export { CopyButton, type CopyButtonProps } from "./components/CopyButton";
export { Card } from "./components/Card";

// Layout
export { AppShell, useAppShell, type AppShellProps } from "./layout/AppShell";
export { TopBar, type TopBarProps } from "./layout/TopBar";
export { Sidebar, SidebarNav, SidebarItem, type SidebarProps, type SidebarNavProps, type SidebarItemProps } from "./layout/Sidebar";
export {
  PageHeader,
  PageBody,
  SectionHeader,
  type PageHeaderProps,
  type PageBodyProps,
  type SectionHeaderProps,
  type Crumb,
} from "./layout/PageHeader";
export {
  SettingsLayout,
  SettingsSection,
  type SettingsLayoutProps,
  type SettingsSectionProps,
  type SettingsNavItem,
} from "./layout/SettingsLayout";

// Identity
export {
  KORE_PRODUCTS,
  KORE_APP_IDS,
  productName,
  type AppId,
  type ProductId,
  type AppInfo,
  type AppUrls,
  type AppNames,
} from "./identity/apps";
export { AppMark, Wordmark, KoreLogo, type AppMarkProps, type WordmarkProps } from "./identity/AppMark";
export { AppSwitcher, AppGrid, type AppSwitcherProps, type AppGridProps } from "./identity/AppSwitcher";
export { AccountMenu, type AccountMenuProps, type AccountUser } from "./identity/AccountMenu";
export { AuthScreen, type AuthScreenProps, type PasswordSignIn, type KoreIdSignIn } from "./identity/AuthScreen";
