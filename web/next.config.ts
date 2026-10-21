import type { NextConfig } from "next";

// Where the Go API listens. Used by the dev/e2e rewrite below (baked in at
// build time) and, at runtime, by server-side `api()` calls (lib/api.ts).
const apiUrl = (process.env.API_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // In production Caddy routes /api/* to the Go service before requests reach
  // Next, so this rewrite only matters when Next is hit directly (dev, e2e).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
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
