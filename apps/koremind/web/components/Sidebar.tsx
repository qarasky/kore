"use client";
import { LogOut, Plus, Settings, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Wordmark } from "./Mark";
import { useChats } from "@/lib/contexts";
import { quick, spring } from "@/lib/motion";
import { useSession } from "@/lib/session";
import { t } from "@/lib/strings";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { chats, remove } = useChats();
  const { user, signOut } = useSession();
  const path = usePathname();
  const router = useRouter();
  const go = () => onNavigate?.();

  return (
    <nav aria-label="Chats" className="flex h-full w-64 flex-col border-r border-border bg-surface">
      <div className="flex h-16 items-center px-4"><Wordmark /></div>
      <div className="px-3">
        <Link href="/" onClick={go} className="flex min-h-control items-center gap-2 rounded-ui bg-raised px-3 text-sub font-medium hover:bg-border"><Plus size={16} aria-hidden />{t.newChat}</Link>
      </div>
      <ul className="mt-3 min-h-0 flex-1 overflow-y-auto px-2">
        {chats.length === 0 && <li className="px-3 py-2 text-meta text-muted">{t.noChats}</li>}
        <AnimatePresence initial={false} mode="popLayout">
        {chats.map((c) => {
          const active = path === `/c/${c.id}`;
          return (
            <motion.li key={c.id} layout transition={spring} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16, transition: quick }} className={`group flex items-center rounded-ui ${active ? "bg-raised" : "hover:bg-raised/60"}`}>
              <Link href={`/c/${c.id}`} onClick={go} className="min-h-control flex-1 truncate px-3 py-2 text-sub" aria-current={active ? "page" : undefined}><motion.span key={c.title} className="block truncate" initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>{c.title}</motion.span></Link>
              <button type="button" aria-label={t.deleteChat} onClick={async () => { await remove(c.id); if (active) router.push("/"); }} className="mr-1 grid size-control-sm place-items-center rounded-ui text-muted opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"><Trash2 size={15} /></button>
            </motion.li>
          );
        })}
        </AnimatePresence>
      </ul>
      <div className="border-t border-border p-2">
        <Link href="/settings" onClick={go} className="flex min-h-control items-center gap-2 rounded-ui px-3 text-sub hover:bg-raised"><Settings size={16} aria-hidden />{t.settings}</Link>
        <button type="button" onClick={() => void signOut()} className="flex min-h-control w-full items-center gap-2 rounded-ui px-3 text-left text-sub text-muted hover:bg-raised hover:text-text"><LogOut size={16} aria-hidden /><span className="truncate">{user?.email}</span></button>
      </div>
    </nav>
  );
}
