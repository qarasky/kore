import type { NextConfig } from "next";

// Where the Go API listens. Used by the dev/e2e rewrite below (baked in at
// build time) and, at runtime, by server-side `api()` calls (lib/api.ts).
const apiUrl = (process.env.API_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
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
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
