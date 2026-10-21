import { FolderPage, folderMetadata } from "@/components/FolderPage";

export async function generateMetadata({ params }: PageProps<"/files/[[...folder]]">) {
  return folderMetadata("personal", (await params).folder);
}

export default async function MyFilesPage({ params }: PageProps<"/files/[[...folder]]">) {
  return <FolderPage space="personal" segments={(await params).folder} />;
}
