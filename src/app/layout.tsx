import type { ReactNode } from "react";

import { headers } from "next/headers";

import type { Metadata, Viewport } from "next";

import { ServiceWorkerRegister } from "@/components/pwa/sw-register";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APP_CONFIG } from "@/config/app-config";
import { fontVars } from "@/lib/fonts/registry";
import { PREFERENCE_DEFAULTS } from "@/lib/preferences/preferences-config";
import { ThemeBootScript } from "@/scripts/theme-boot";
import { PreferencesStoreProvider } from "@/stores/preferences/preferences-provider";

import "./globals.css";

export const metadata: Metadata = {
  // Absolute basis voor og-/twitter-afbeeldingen: WhatsApp en andere
  // link-previews vereisen absolute URL's (zonder deze base valt WhatsApp
  // terug op de kleine favicon — het wazige voorbeeld).
  metadataBase: new URL("https://www.careonpulse.com"),
  title: {
    default: APP_CONFIG.meta.title,
    template: `%s · ${APP_CONFIG.name}`,
  },
  description: APP_CONFIG.meta.description,
  applicationName: APP_CONFIG.name,
  appleWebApp: {
    capable: true,
    title: APP_CONFIG.name,
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
  // De og-afbeelding zelf komt uit src/app/opengraph-image.png (file-conventie).
  // Titel en omschrijving komen uit APP_CONFIG.meta en zijn bewust klantneutraal:
  // robots.txt houdt crawlers tegen, maar niet de link-previews van WhatsApp,
  // Teams of Slack. Voeg hier dus nooit een klantnaam toe.
  openGraph: {
    type: "website",
    locale: "nl_NL",
    siteName: APP_CONFIG.name,
    title: APP_CONFIG.meta.title,
    description: APP_CONFIG.meta.description,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export const viewport: Viewport = {
  themeColor: "#07091a",
  viewportFit: "cover",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { theme_mode, theme_preset, content_layout, navbar_style, sidebar_variant, sidebar_collapsible, font } =
    PREFERENCE_DEFAULTS;
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="nl"
      data-theme-mode={theme_mode}
      data-theme-preset={theme_preset}
      data-content-layout={content_layout}
      data-navbar-style={navbar_style}
      data-sidebar-variant={sidebar_variant}
      data-sidebar-collapsible={sidebar_collapsible}
      data-font={font}
      suppressHydrationWarning
    >
      <head>
        {/* Applies theme and layout preferences on load to avoid flicker and unnecessary server rerenders. */}
        <ThemeBootScript nonce={nonce} />
      </head>
      <body className={`${fontVars} min-h-screen antialiased`}>
        <TooltipProvider>
          <PreferencesStoreProvider initialValues={PREFERENCE_DEFAULTS}>
            {children}
            <Toaster />
          </PreferencesStoreProvider>
        </TooltipProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
