import { KORE_THEME_COLOR, themeInitScript } from "@qarasky/kore-ui";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = { title: "KoreMind", description: "Your personal assistant" };
export const viewport: Viewport = { themeColor: KORE_THEME_COLOR };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Sets data-theme before the first paint, so a saved Light or Dark never flashes Color first. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
