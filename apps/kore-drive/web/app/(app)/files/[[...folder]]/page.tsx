import { FolderPage, folderMetadata } from "@/components/FolderPage";

export async function generateMetadata({ params }: PageProps<"/files/[[...folder]]">) {
  return folderMetadata("personal", (await params).folder);
}

export default async function MyFilesPage({ params, searchParams }: PageProps<"/files/[[...folder]]">) {
  const [{ folder }, { select }] = await Promise.all([params, searchParams]);
  return <FolderPage space="personal" segments={folder} select={select} />;
}
