"use client";
import type { ReactNode } from "react";
import { AppFrame } from "@/components/AppFrame";
import { ChatsProvider, ModelChoiceProvider } from "@/lib/contexts";
import { useSession } from "@/lib/session";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { ready, user } = useSession();
  if (!ready || !user) return null;
  return (
    <ChatsProvider>
      <ModelChoiceProvider>
        <AppFrame>{children}</AppFrame>
      </ModelChoiceProvider>
    </ChatsProvider>
  );
}
