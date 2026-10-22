import type { MetadataRoute } from "next";

/** A private server: ask every crawler to stay out. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
