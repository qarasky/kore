"use client";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { ChatsProvider, ModelChoiceProvider } from "@/lib/contexts";
import { useSession } from "@/lib/session";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { ready, user } = useSession();
  if (!ready || !user) return null;
  return (
    <ChatsProvider>
      <ModelChoiceProvider><motion.div className="h-dvh" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>{children}</motion.div></ModelChoiceProvider>
    </ChatsProvider>
  );
}
