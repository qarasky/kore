"use client";

import { useRef, type ChangeEvent } from "react";
import { collectInputFiles } from "@/lib/dropEntries";
import { t } from "@/lib/i18n";
import { useBrowserHandle } from "./BrowserContext";
import { FileUploadIcon, FolderPlusIcon, FolderUploadIcon, PlusIcon } from "./icons";
import { Dropdown, type MenuAction } from "./Menu";
import { useUploads } from "./UploadContext";

/** The sidebar's "+ New" button. Entries act on the folder currently shown. */
export function NewMenu() {
  const browser = useBrowserHandle();
  const uploads = useUploads();
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  function onPicked(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const files = [...(input.files ?? [])];
    input.value = ""; // picking the same files again fires change again
    if (!browser || files.length === 0) return;
    void uploads.upload(collectInputFiles(files), { space: browser.space, parent: browser.parentId });
  }

  const items: MenuAction[] = [
    {
      id: "folder",
      label: t("new.folder"),
      icon: <FolderPlusIcon />,
      disabled: !browser,
      onSelect: () => browser?.newFolder(),
    },
    {
      id: "file-upload",
      label: t("new.fileUpload"),
      icon: <FileUploadIcon />,
      disabled: !browser,
      separated: true,
      onSelect: () => fileInput.current?.click(),
    },
    {
      id: "folder-upload",
      label: t("new.folderUpload"),
      icon: <FolderUploadIcon />,
      disabled: !browser,
      onSelect: () => folderInput.current?.click(),
    },
  ];

  return (
    <>
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
      <input ref={fileInput} type="file" multiple hidden tabIndex={-1} data-testid="upload-file-input" onChange={onPicked} />
      <input
        ref={(el) => {
          folderInput.current = el;
          if (el) el.webkitdirectory = true; // no React prop for this attribute
        }}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        data-testid="upload-folder-input"
        onChange={onPicked}
      />
    </>
  );
}
