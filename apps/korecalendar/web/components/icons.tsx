import {
  AlignLeft,
  Bell,
  Calendar as CalendarIcon,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Globe,
  Keyboard,
  KeyRound,
  LogOut,
  MapPin,
  Menu as MenuIcon,
  Pencil,
  Plus,
  Repeat,
  Search,
  Settings,
  Trash2,
  Undo2,
  Upload,
  Users,
  X,
  type LucideProps,
} from "lucide-react";

/** Icons come from lucide-react (bundled, tree-shaken: nothing is downloaded).
 *  All app icons go through here so sizing and stroke stay uniform. */
function make(Icon: typeof CalendarIcon) {
  return function Wrapped(props: LucideProps) {
    return <Icon size={18} strokeWidth={1.75} aria-hidden="true" {...props} />;
  };
}

export const AlignLeftIcon = make(AlignLeft);
export const BellIcon = make(Bell);
export const CalendarDaysIcon = make(CalendarIcon);
export const CheckIcon = make(Check);
export const ChevronDownIcon = make(ChevronDown);
export const ChevronLeftIcon = make(ChevronLeft);
export const ChevronRightIcon = make(ChevronRight);
export const ClockIcon = make(Clock);
export const DownloadIcon = make(Download);
export const GlobeIcon = make(Globe);
export const KeyboardIcon = make(Keyboard);
export const KeyRoundIcon = make(KeyRound);
export const LogOutIcon = make(LogOut);
export const MapPinIcon = make(MapPin);
export const MenuIcon_ = make(MenuIcon);
export const PencilIcon = make(Pencil);
export const PlusIcon = make(Plus);
export const RepeatIcon = make(Repeat);
export const SearchIcon = make(Search);
export const SettingsIcon = make(Settings);
export const Trash2Icon = make(Trash2);
export const Undo2Icon = make(Undo2);
export const UploadIcon = make(Upload);
export const UsersIcon = make(Users);
export const XIcon = make(X);
