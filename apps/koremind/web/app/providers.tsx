"use client";
import { KoreProvider } from "@qarasky/kore-ui";
import { MotionConfig } from "motion/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { SessionProvider } from "@/lib/session";

/** kore-ui (Next's Link for in-app links, tooltips, toasts), the OS "reduce motion" setting for every animation, the session. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <KoreProvider linkComponent={Link}>
      <MotionConfig reducedMotion="user">
        <SessionProvider>{children}</SessionProvider>
      </MotionConfig>
    </KoreProvider>
  );
}
