import "./globals.css";

import { themeInitScript } from "@qarasky/kore-ui";
import type { Metadata } from "next";

import { Providers } from "./providers";

export const metadata: Metadata = {
    title: "KoreMonitor",
    robots: { index: false, follow: false },
};

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
