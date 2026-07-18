import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig = {
  // Aparte build-map instelbaar via env: Windows-dev en WSL-builds delen deze
  // map via /mnt/c en corrumperen anders elkaars .next-cache/lockfile.
  // WSL-kant: NEXT_DIST_DIR=.next-wsl npm run dev/build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Expliciete workspace-root: voorkomt dat Turbopack de bovenliggende
  // projectmap als root kiest (en die hele boom gaat watchen) wanneer daar
  // per ongeluk een lockfile belandt.
  turbopack: {
    root: path.dirname(fileURLToPath(import.meta.url)),
  },
  reactCompiler: true,
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        // The service worker must always revalidate so new deploys take over.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/dashboard",
        destination: "/dashboard/directiecockpit",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
