"use client";

import { Button, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@qarasky/kore-ui";
import { FileUp, FolderPlus, FolderUp, Plus } from "lucide-react";
import { useRef, type ChangeEvent } from "react";
import { collectInputFiles } from "@/lib/dropEntries";
import { t } from "@/lib/i18n";
import { useBrowserHandle } from "./BrowserContext";
import { useUploads } from "./UploadContext";

/** The sidebar's "+ New" button (kore-ui Menu). Entries act on the folder currently shown. */
export function NewMenu() {
  const browser = useBrowserHandle();
  const uploads = useUploads();
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  // "New folder" runs once the menu has closed: the open menu traps focus, so
  // the inline name field would lose it, and closing would move it back to "New".
  const afterClose = useRef<(() => void) | null>(null);

  function onPicked(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const files = [...(input.files ?? [])];
    input.value = ""; // picking the same files again fires change again
    if (!browser || files.length === 0) return;
    void uploads.upload(collectInputFiles(files), { space: browser.space, parent: browser.parentId });
  }

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="primary" className="pr-5 pl-4">
            <Plus />
            {t("new.button")}
          </Button>
        </MenuTrigger>
        <MenuContent
          aria-label={t("new.menu")}
          onCloseAutoFocus={(e) => {
            const run = afterClose.current;
            afterClose.current = null;
            if (!run) return;
            e.preventDefault();
            run();
          }}
        >
          <MenuItem icon={<FolderPlus />} disabled={!browser} onSelect={() => {
              afterClose.current = () => browser?.newFolder();
            }}>
            {t("new.folder")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<FileUp />} disabled={!browser} onSelect={() => fileInput.current?.click()}>
            {t("new.fileUpload")}
          </MenuItem>
          <MenuItem icon={<FolderUp />} disabled={!browser} onSelect={() => folderInput.current?.click()}>
            {t("new.folderUpload")}
          </MenuItem>
        </MenuContent>
      </Menu>
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
