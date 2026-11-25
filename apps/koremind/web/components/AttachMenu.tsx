"use client";
import { IconButton, Menu, MenuContent, MenuItem, MenuTrigger } from "@qarasky/kore-ui";
import { Camera, Image as ImageIcon, Paperclip, Plus } from "lucide-react";
import { useRef, type ChangeEvent } from "react";
import { t } from "@/lib/strings";

/** The "+" menu: photo library, take a photo (opens the camera on phones, a file picker on desktops) or any file. */
export function AttachMenu({ onFiles }: { onFiles(files: File[]): void }) {
  const photos = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const picked = (e: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []); // copied first: clearing the input empties the live list
    e.target.value = "";
    if (list.length) onFiles(list);
  };
  return (
    <>
      <input ref={photos} type="file" multiple accept="image/*" hidden onChange={picked} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={picked} />
      <input ref={files} type="file" multiple accept="image/*,application/pdf,text/*,application/json" hidden onChange={picked} />
      <Menu>
        <MenuTrigger asChild>
          <IconButton label={t.attach} icon={<Plus />} />
        </MenuTrigger>
        <MenuContent side="top" align="start">
          <MenuItem icon={<ImageIcon />} onSelect={() => photos.current?.click()}>{t.attachPhoto}</MenuItem>
          <MenuItem icon={<Camera />} onSelect={() => camera.current?.click()}>{t.takePhoto}</MenuItem>
          <MenuItem icon={<Paperclip />} onSelect={() => files.current?.click()}>{t.attachFile}</MenuItem>
        </MenuContent>
      </Menu>
    </>
  );
}
