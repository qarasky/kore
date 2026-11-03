# @qarasky/kore-ui

The Kore design system: tokens, theme and React components shared by every Kore web UI (Kore, KoreMind,
KoreCalendar, KoreMonitor and Kore ID). React 19, Tailwind v4, Radix (`radix-ui`), lucide icons. Dark only.

**[DESIGN.md](DESIGN.md) is the source of truth**: principles, tokens, layout, every component's anatomy and
rules, voice, accessibility, the decisions behind them, and how to migrate each app.

The package ships TypeScript source and CSS, with no build step. Your bundler compiles it.

## Install

Pin a release tag:

```jsonc
// package.json
"dependencies": {
  "@qarasky/kore-ui": "https://codeload.github.com/qarasky/kore-ui/tar.gz/refs/tags/v0.1.0"
}
```

Peer dependencies: `react` and `react-dom` ^19, `tailwindcss` ^4. Radix, lucide-react, clsx, tailwind-merge,
class-variance-authority and the Inter font (`@fontsource-variable/inter`) are regular dependencies. Add
`lucide-react` to your own dependencies too if you import icons yourself.

## CSS

In your main stylesheet (e.g. `app/globals.css`):

```css
@import "tailwindcss";
@import "@qarasky/kore-ui/theme.css";
/* Tailwind must scan kore-ui's source for class names. Path is relative to this CSS file. */
@source "../node_modules/@qarasky/kore-ui/src";
```

`theme.css` defines the tokens (`bg-surface`, `text-muted`, `h-row`, `max-w-form`, …), loads Inter, and sets base
styles (15px root, focus ring, selection, scrollbars, reduced motion). Don't redefine these tokens in the app.

## Next.js

```ts
// next.config.ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  transpilePackages: ["@qarasky/kore-ui"],
};
export default nextConfig;
```

Use `@tailwindcss/postcss` (or `@tailwindcss/turbopack`) as usual. Give kore-ui your router's link from a client
component:

```tsx
// app/providers.tsx
"use client";
import Link from "next/link";
import { KoreProvider } from "@qarasky/kore-ui";

export function Providers({ children }: { children: React.ReactNode }) {
  return <KoreProvider linkComponent={Link}>{children}</KoreProvider>;
}
```

```tsx
// app/layout.tsx
import "./globals.css";
import { Providers } from "./providers";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

Interactive components are marked `"use client"`, so server components can import from `@qarasky/kore-ui`
directly; handlers (`onClick`, `onSignOut`) still have to come from client components.

## Vite

```ts
// vite.config.ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [react(), tailwindcss()] });
```

Same CSS as above. Wrap the app in `<KoreProvider linkComponent={YourRouterLink}>` (or leave it out of the props
for plain `<a>` links).

## Use

```tsx
import { AppShell, TopBar, Sidebar, SidebarNav, SidebarItem, PageHeader, PageBody, Button, Wordmark,
  AccountMenu, AppSwitcher } from "@qarasky/kore-ui";
import { HardDrive, Plus } from "lucide-react";

const apps = { kore: "https://files.example.com", koremind: "https://mind.example.com" };

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      brand={<Wordmark app="kore" />}
      brandHref="/files"
      topBar={
        <TopBar
          actions={
            <>
              <AppSwitcher urls={apps} current="kore" />
              <AccountMenu user={{ email: "anna@example.com" }} accountUrl="https://id.example.com/account"
                apps={{ urls: apps, current: "kore" }} onSignOut={signOut} />
            </>
          }
        />
      }
      sidebar={
        <Sidebar header={<Button variant="primary"><Plus /> New</Button>}>
          <SidebarNav label="Sections">
            <SidebarItem href="/files" icon={<HardDrive />} active>My files</SidebarItem>
          </SidebarNav>
        </Sidebar>
      }
    >
      <PageHeader title="My files" />
      <PageBody>{children}</PageBody>
    </AppShell>
  );
}
```

## Components

Primitives: Button, IconButton, Input, Textarea, Field, Select, Checkbox, Switch, RadioGroup, Dialog,
ConfirmDialog, Menu, ContextMenu, Popover, Tooltip, Tabs, NavTabs, Toast (`useToast`), Table, Badge, StatusDot,
Avatar, EmptyState, Spinner, Skeleton, Kbd, CopyButton, Card. Layout: AppShell, TopBar, Sidebar, SidebarNav,
SidebarItem, PageHeader, PageBody, SectionHeader, SettingsLayout, SettingsSection. Identity: AccountMenu,
AppSwitcher, AppGrid, AuthScreen, AppMark, Wordmark, KoreLogo. Utilities: `cn`, `KoreProvider`.

## Develop

```sh
npm install && npm run showcase:install
npm run dev          # showcase at http://localhost:5173 (every component, app shell, table, settings, sign-in)
npm test             # vitest + Testing Library
npm run typecheck    # library + showcase
npm run build        # builds the showcase
npm run screenshots  # after build: writes docs/screenshots/*.png with Playwright
```

The showcase depends on the package through `file:..` and imports it exactly like an app does (package exports,
`theme.css`, `@source`), so it doubles as the consumption test.

Releases: semver tags `vX.Y.Z`; apps pin a tag. While < 1.0, breaking changes bump the minor.
