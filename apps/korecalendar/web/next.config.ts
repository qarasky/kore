import path from "node:path";
import type { NextConfig } from "next";

// The monorepo root: dependencies (next, kore-ui) are hoisted there. Standalone output is
// traced from it, so the server is at .next/standalone/<this app's path>/server.js.
const repoRoot = path.resolve(import.meta.dirname, "../../..");

// Where the Go API listens. Used by the dev/e2e rewrite below (baked in at
// build time) and, at runtime, by server-side `api()` calls (lib/api.ts).
const apiUrl = (process.env.API_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  poweredByHeader: false,
  // kore-ui ships TypeScript source; Next compiles it with the app.
  transpilePackages: ["@qarasky/kore-ui"],
  // In production Caddy routes /api/*, /dav/* (CalDAV) and /.well-known/caldav to
  // the Go service before requests reach Next, so this rewrite only matters when
  // Next is hit directly (dev, e2e). CalDAV is not proxied here: Next's rewrite
  // does not forward PROPFIND/REPORT, so in development use the API's own port.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
  async headers() {
    // The service worker must always be fetched fresh so updates reach browsers.
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] }];
  },
  turbopack: {
    root: repoRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
