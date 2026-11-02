"use client";
import type { ReactNode } from "react";
import { ChatsProvider, ModelChoiceProvider } from "@/lib/contexts";
import { useSession } from "@/lib/session";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { ready, user } = useSession();
  if (!ready || !user) return null;
  return (
    <ChatsProvider>
      <ModelChoiceProvider>{children}</ModelChoiceProvider>
    </ChatsProvider>
  );
}
