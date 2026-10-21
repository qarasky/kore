"use client";

import { t } from "@/lib/i18n";
import { useBrowserHandle } from "./BrowserContext";
import { FolderPlusIcon, PlusIcon } from "./icons";
import { Dropdown, type MenuAction } from "./Menu";

/** The sidebar's "+ New" button. Entries act on the folder currently shown. */
export function NewMenu() {
  const browser = useBrowserHandle();

  const items: MenuAction[] = [
    {
      id: "folder",
      label: t("new.folder"),
      icon: <FolderPlusIcon />,
      disabled: !browser,
      onSelect: () => browser?.newFolder(),
    },
    // Task 14 adds "Upload files" / "Upload folder" here (separated: true).
  ];

  return (
    <Dropdown
      label={t("new.menu")}
      items={items}
      buttonClassName={
        "flex items-center gap-2 rounded-ui bg-accent py-2 pr-4 pl-3 font-medium text-white " +
        "shadow-[0_1px_0_rgba(255,255,255,0.12)_inset] transition-colors hover:bg-accent-hover"
      }
    >
      <PlusIcon />
      {t("new.button")}
    </Dropdown>
  );
}
