import localFont from "next/font/local";

import { GeistPixelSquare } from "geist/font/pixel";

// Lokaal gehoste varianten van de voormalige next/font/google-families
// (variabele latin-woff2's in ./files, gedekt: Nederlands incl. diakrieten).
// Reden: next/font/google downloadt fonts tijdens build/dev en Turbopacks
// fetcher faalt willekeurig op netwerken met geadverteerd-maar-dood IPv6 —
// lokale bestanden maken build en dev volledig netwerk-onafhankelijk.
// CSS-variabelen, registry-sleutels en labels zijn ongewijzigd.

const inter = localFont({
  src: "./files/inter-latin.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-inter",
});

const notoSans = localFont({
  src: "./files/noto-sans-latin.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-noto-sans",
});

const roboto = localFont({
  src: "./files/roboto-latin.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-roboto",
});

const geist = localFont({
  src: "./files/geist-latin.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-geist",
});

const outfit = localFont({
  src: "./files/outfit-latin.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-outfit",
});

const geistMono = localFont({
  src: "./files/geist-mono-latin.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-geist-mono",
});

const dmSans = localFont({
  src: "./files/dm-sans-latin.woff2",
  weight: "100 1000",
  display: "swap",
  variable: "--font-dm-sans",
});

const nunitoSans = localFont({
  src: "./files/nunito-sans-latin.woff2",
  weight: "200 1000",
  display: "swap",
  variable: "--font-nunito-sans",
});

const figtree = localFont({
  src: "./files/figtree-latin.woff2",
  weight: "300 900",
  display: "swap",
  variable: "--font-figtree",
});

const raleway = localFont({
  src: "./files/raleway-latin.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-raleway",
});

const publicSans = localFont({
  src: "./files/public-sans-latin.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-public-sans",
});

const jetBrainsMono = localFont({
  src: "./files/jetbrains-mono-latin.woff2",
  weight: "100 800",
  display: "swap",
  variable: "--font-jetbrains-mono",
});

const notoSerif = localFont({
  src: "./files/noto-serif-latin.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-noto-serif",
});

const robotoSlab = localFont({
  src: "./files/roboto-slab-latin.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-roboto-slab",
});

const merriweather = localFont({
  src: "./files/merriweather-latin.woff2",
  weight: "300 900",
  display: "swap",
  variable: "--font-merriweather",
});

const lora = localFont({
  src: "./files/lora-latin.woff2",
  weight: "400 700",
  display: "swap",
  variable: "--font-lora",
});

const playfairDisplay = localFont({
  src: "./files/playfair-display-latin.woff2",
  weight: "400 900",
  display: "swap",
  variable: "--font-playfair-display",
});

export const fontRegistry = {
  geist: {
    label: "Geist",
    font: geist,
  },
  inter: {
    label: "Inter",
    font: inter,
  },
  notoSans: {
    label: "Noto Sans",
    font: notoSans,
  },
  nunitoSans: {
    label: "Nunito Sans",
    font: nunitoSans,
  },
  figtree: {
    label: "Figtree",
    font: figtree,
  },
  roboto: {
    label: "Roboto",
    font: roboto,
  },
  raleway: {
    label: "Raleway",
    font: raleway,
  },
  dmSans: {
    label: "DM Sans",
    font: dmSans,
  },
  publicSans: {
    label: "Public Sans",
    font: publicSans,
  },
  outfit: {
    label: "Outfit",
    font: outfit,
  },
  geistMono: {
    label: "Geist Mono",
    font: geistMono,
  },
  geistPixelSquare: {
    label: "Geist Pixel Square",
    font: GeistPixelSquare,
  },
  jetBrainsMono: {
    label: "JetBrains Mono",
    font: jetBrainsMono,
  },
  notoSerif: {
    label: "Noto Serif",
    font: notoSerif,
  },
  robotoSlab: {
    label: "Roboto Slab",
    font: robotoSlab,
  },
  merriweather: {
    label: "Merriweather",
    font: merriweather,
  },
  lora: {
    label: "Lora",
    font: lora,
  },
  playfairDisplay: {
    label: "Playfair Display",
    font: playfairDisplay,
  },
} as const;

export type FontKey = keyof typeof fontRegistry;

export const fontKeys = Object.keys(fontRegistry) as FontKey[];

export const fontVars = Object.values(fontRegistry)
  .map(({ font }) => font.variable)
  .join(" ");

export const fontOptions = fontKeys.map((key) => ({
  key,
  label: fontRegistry[key].label,
}));
