import { FolderPage, folderMetadata } from "@/components/FolderPage";

export async function generateMetadata({ params }: PageProps<"/shared/[[...folder]]">) {
  return folderMetadata("shared", (await params).folder);
}

export default async function SharedPage({ params }: PageProps<"/shared/[[...folder]]">) {
  return <FolderPage space="shared" segments={(await params).folder} />;
}
