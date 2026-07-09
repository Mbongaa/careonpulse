import type { MetadataRoute } from "next";

import { APP_CONFIG } from "@/config/app-config";

// Web app manifest — makes Careon Pulse installable on phones (Add to Home
// Screen / install prompt) and defines how it launches as a standalone app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/dashboard/directiecockpit",
    name: APP_CONFIG.meta.title,
    short_name: APP_CONFIG.name,
    description: APP_CONFIG.meta.description,
    lang: "nl",
    start_url: "/dashboard/directiecockpit",
    scope: "/",
    display: "standalone",
    background_color: "#07091a",
    theme_color: "#07091a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Signaleringen",
        url: "/dashboard/signaleringen",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "AI-assistent",
        url: "/dashboard/assistent",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
