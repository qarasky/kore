import type { MetadataRoute } from "next";
import { KORE_THEME_COLOR } from "@qarasky/kore-ui";
import { t } from "@/lib/i18n";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: t("app.name"),
    short_name: t("app.name"),
    description: t("app.description"),
    start_url: "/",
    display: "standalone",
    background_color: KORE_THEME_COLOR,
    theme_color: KORE_THEME_COLOR,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
