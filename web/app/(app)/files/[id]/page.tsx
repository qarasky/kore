import { notFound } from "next/navigation";
import { api, isApiError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { FilesPlaceholder } from "../placeholder";

type PathNode = { id: string; name: string; is_dir: boolean };

export default async function FolderPage({ params }: PageProps<"/files/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  let path: PathNode[];
  try {
    path = await api<PathNode[]>(`/api/nodes/${encodeURIComponent(id)}/path`);
  } catch (e) {
    if (isApiError(e, 404)) notFound();
    throw e;
  }
  return <FilesPlaceholder user={user} folder={path.at(-1)?.name ?? ""} />;
}
