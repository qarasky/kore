import { FolderPage, folderMetadata } from "@/components/FolderPage";

export async function generateMetadata({ params }: PageProps<"/shared/[[...folder]]">) {
  return folderMetadata("shared", (await params).folder);
}

export default async function SharedPage({ params, searchParams }: PageProps<"/shared/[[...folder]]">) {
  const [{ folder }, { select }] = await Promise.all([params, searchParams]);
  return <FolderPage space="shared" segments={folder} select={select} />;
}
