import type { Metadata } from "next";
import { folderIdFrom, loadFolder } from "@/lib/folder";
import { t } from "@/lib/i18n";
import type { Space } from "@/lib/nodes";
import { requireUser } from "@/lib/session";
import { Breadcrumbs } from "./Breadcrumbs";
import { FileList } from "./FileList";

const sectionTitle = (space: Space) => (space === "shared" ? t("shared.title") : t("files.title"));

/** Shared server body of /files/[[...folder]] and /shared/[[...folder]]. */
export async function FolderPage({ space, segments }: { space: Space; segments: string[] | undefined }) {
  const id = folderIdFrom(segments);
  await requireUser();
  const folder = await loadFolder(space, id);
  return (
    <FileList
      key={id ?? "root"}
      space={space}
      parentId={id}
      nodes={folder.children}
      header={<Breadcrumbs space={space} path={folder.path} />}
    />
  );
}

export async function folderMetadata(space: Space, segments: string[] | undefined): Promise<Metadata> {
  const id = folderIdFrom(segments);
  if (id === null) return { title: sectionTitle(space) };
  await requireUser();
  const folder = await loadFolder(space, id);
  return { title: folder.path.at(-1)?.name ?? sectionTitle(space) };
}
