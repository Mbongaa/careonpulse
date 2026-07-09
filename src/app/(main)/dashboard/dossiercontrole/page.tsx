import type { Metadata } from "next";

import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

import { DossiercontroleContent } from "./_components/dossiercontrole-content";

export const metadata: Metadata = {
  title: CAREON_PAGE_META.dossiers.title,
  description: CAREON_PAGE_META.dossiers.sub,
};

export default function Page() {
  return <DossiercontroleContent />;
}
