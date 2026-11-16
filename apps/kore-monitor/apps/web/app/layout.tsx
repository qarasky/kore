import "./globals.css";

import { KORE_THEME_COLOR, themeInitScript } from "@qarasky/kore-ui";
import type { Metadata, Viewport } from "next";

import { Providers } from "./providers";

export const metadata: Metadata = {
    title: "KoreMonitor",
    robots: { index: false, follow: false },
};

/** The browser chrome colour; kore-ui's ThemeProvider keeps this tag in step with the chosen theme. */
export const viewport: Viewport = { themeColor: KORE_THEME_COLOR };

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        // suppressHydrationWarning: the script below sets data-theme before React hydrates.
        <html lang="en" suppressHydrationWarning>
            <head>
                <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
            </head>
            <body>
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
