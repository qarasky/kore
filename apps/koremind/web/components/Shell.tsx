"use client";
import { Menu } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { t } from "@/lib/strings";

/** Sidebar on wide screens; a drawer on narrow ones. `title` and `right` fill the top bar. */
export function Shell({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-dvh">
      <div className="hidden md:block"><Sidebar /></div>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" aria-label={t.back} className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative h-full w-64"><Sidebar onNavigate={() => setOpen(false)} /></div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 px-2 md:px-4">
          <button type="button" aria-label={t.menu} onClick={() => setOpen(true)} className="grid size-control place-items-center rounded-ui hover:bg-raised md:hidden"><Menu size={20} /></button>
          <h1 className="min-w-0 flex-1 truncate text-center text-heading font-medium md:text-left">{title}</h1>
          <div className="min-w-10">{right}</div>
        </header>
        {children}
      </div>
    </div>
  );
}
