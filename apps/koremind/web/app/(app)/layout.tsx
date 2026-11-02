"use client";
import type { ReactNode } from "react";
import { useSession } from "@/lib/session";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { ready, user } = useSession();
  if (!ready || !user) return null;
  return <>{children}</>;
}
