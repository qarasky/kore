import { join } from "node:path";
import type { NextConfig } from "next";

// The Docker image builds with KOREMIND_STANDALONE=1 to get a small self-contained server.
const standalone = process.env.KOREMIND_STANDALONE === "1";
const config: NextConfig = {
  transpilePackages: ["@koremind/shared", "@qarasky/kore-ui"],
  reactStrictMode: true,
  ...(standalone ? { output: "standalone" as const, outputFileTracingRoot: join(import.meta.dirname, "..") } : {}),
};
export default config;
