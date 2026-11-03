import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { MotionRoot } from "@/components/MotionRoot";
import { SessionProvider } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = { title: "KoreMind", description: "Your personal assistant" };
export const viewport: Viewport = { themeColor: "#16181d", colorScheme: "dark" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <MotionRoot><SessionProvider>{children}</SessionProvider></MotionRoot>
      </body>
    </html>
  );
}
