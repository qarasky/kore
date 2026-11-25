import { join } from "node:path";
import type { NextConfig } from "next";

// The Kore monorepo root: next, react and kore-ui are hoisted to its node_modules. Turbopack resolves
// nothing outside its root, and the standalone output is traced from it, so the server sits at
// .next/standalone/apps/koremind/web/server.js.
const repoRoot = join(import.meta.dirname, "../../..");
// The Docker image builds with KOREMIND_STANDALONE=1 to get a small self-contained server.
const standalone = process.env.KOREMIND_STANDALONE === "1";
const config: NextConfig = {
  transpilePackages: ["@koremind/shared", "@qarasky/kore-ui"],
  reactStrictMode: true,
  turbopack: { root: repoRoot },
  ...(standalone ? { output: "standalone" as const, outputFileTracingRoot: repoRoot } : {}),
};
export default config;
