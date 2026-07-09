import type { Metadata } from "next";

import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

import { KwaliteitContent } from "./_components/kwaliteit-content";

export const metadata: Metadata = {
  title: CAREON_PAGE_META.kwaliteit.title,
  description: CAREON_PAGE_META.kwaliteit.sub,
};

export default function Page() {
  return <KwaliteitContent />;
}
