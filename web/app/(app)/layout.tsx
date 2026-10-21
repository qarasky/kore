import Link from "next/link";
import { AccountMenu } from "@/components/AccountMenu";
import { BrowserProvider } from "@/components/BrowserContext";
import { NewMenu } from "@/components/NewMenu";
import { SearchBox } from "@/components/SearchBox";
import { SidebarNav } from "@/components/SidebarNav";
import { StorageMeter } from "@/components/StorageMeter";
import { ToastProvider } from "@/components/Toast";
import { UploadProvider } from "@/components/UploadContext";
import { Wordmark } from "@/components/wordmark";
import { api } from "@/lib/api";
import type { Usage } from "@/lib/nodes";
import { requireUser } from "@/lib/session";

/** App shell: top bar (search, account), sidebar (+ New, sections, storage), content panel. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const usage = await api<Usage>("/api/me/usage");

  return (
    <ToastProvider>
      <BrowserProvider>
        <UploadProvider>
          <div className="flex h-dvh flex-col">
            <header className="flex h-14 shrink-0 items-center gap-4 pr-3 pl-5">
              <Link href="/files" className="w-[208px] shrink-0 rounded-ui text-[16px]">
                <Wordmark />
              </Link>
              <div className="flex min-w-0 flex-1">
                <SearchBox />
              </div>
              <AccountMenu email={user.email} />
            </header>
            <div className="flex min-h-0 flex-1">
              <aside className="flex w-[232px] shrink-0 flex-col gap-4 px-3 pb-4">
                <div className="pl-0.5">
                  <NewMenu />
                </div>
                <SidebarNav isAdmin={user.role === "admin"} />
                <div className="mt-auto">
                  <StorageMeter usage={usage} />
                </div>
              </aside>
              <main className="mr-2 mb-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[8px] border border-border bg-surface">
                {children}
              </main>
            </div>
          </div>
        </UploadProvider>
      </BrowserProvider>
    </ToastProvider>
  );
}
