import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ...(process.env.NODE_ENV === "production"
    ? [
        // Preload is an irreversible domain-wide commitment. Enable it only
        // after every subdomain is verified as HTTPS-only.
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      ]
    : []),
];

const nextConfig = {
  poweredByHeader: false,
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
  // Facturatie-pdf: react-pdf server-side buiten de bundel houden (Turbopack
  // bundelt de CJS/fontkit-boom anders stuk) en de server-TTF's meenemen in
  // de Vercel-trace, anders faalt renderToBuffer op een ontbrekend font.
  serverExternalPackages: ["@react-pdf/renderer"],
  outputFileTracingIncludes: {
    // fonts/ (server-TTF's) én assets/ (ingebouwd Careon Group-logo).
    "/api/careon/facturatie/**/*": ["./src/lib/careon-facturatie/pdf/**/*"],
  },
  compiler: {
    // Keep operational warnings and failures observable in production.
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["warn", "error"] } : false,
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
