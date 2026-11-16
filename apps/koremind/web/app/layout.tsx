import { KORE_THEME_COLOR } from "@qarasky/kore-ui";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = { title: "KoreMind", description: "Your personal assistant" };
export const viewport: Viewport = { themeColor: KORE_THEME_COLOR, colorScheme: "dark" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
